// Özel shader enjeksiyonlu malzemeler: kenar parlaması, röntgen tarama halkası, fresnel kenar.
import * as THREE from 'three';

export const sharedUniforms = {
  uTime: { value: 0 },
  uScanR: { value: -100 },
  uScanW: { value: 6 },
  uScanI: { value: 0 },
};

const VERT_DECL = /* glsl */ `
#include <common>
attribute vec3 aTint;
attribute float aGlow;
varying vec3 vTint;
varying float vGlow;
varying vec2 vEdgeUv;
varying vec3 vWorld;
`;

const VERT_BODY = /* glsl */ `
#include <begin_vertex>
vTint = aTint;
vGlow = aGlow;
vEdgeUv = uv;
#ifdef USE_INSTANCING
  vWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
  vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif
`;

const FRAG_DECL = /* glsl */ `
#include <common>
uniform float uTime;
uniform float uScanR;
uniform float uScanW;
uniform float uScanI;
varying vec3 vTint;
varying float vGlow;
varying vec2 vEdgeUv;
varying vec3 vWorld;
`;

/** Bina (kutu) malzemesi: ekran uzayında sabit kalınlıkta parlayan kenarlar + tarama halkası. */
export function createBoxMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0.15 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sharedUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', VERT_DECL)
      .replace('#include <begin_vertex>', VERT_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', FRAG_DECL)
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= vTint * 0.32;')
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        vec2 fw = max(fwidth(vEdgeUv), vec2(1e-5));
        vec2 e2 = min(vEdgeUv, 1.0 - vEdgeUv) / fw;
        float edge = 1.0 - smoothstep(0.4, 1.6, min(e2.x, e2.y));
        float d = length(vWorld.xz);
        float scan = exp(-pow((d - uScanR) / uScanW, 2.0)) * uScanI;
        totalEmissiveRadiance += vTint * (0.035 * vGlow + edge * 0.55 * vGlow + scan * (0.25 + edge * 1.4));`,
      );
  };
  mat.customProgramCacheKey = () => 'xray-box';
  return mat;
}

/** Küre malzemesi: fresnel kenar ışıması (gezegenler ve uydular için). */
export function createOrbMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.2, flatShading: true });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sharedUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', VERT_DECL)
      .replace('#include <begin_vertex>', VERT_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', FRAG_DECL)
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= vTint * 0.4;')
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        vec3 vd = normalize(vViewPosition);
        float rim = pow(1.0 - abs(dot(normal, vd)), 2.2);
        totalEmissiveRadiance += vTint * (0.06 * vGlow + rim * 0.75 * vGlow);`,
      );
  };
  mat.customProgramCacheKey = () => 'xray-orb';
  return mat;
}

/** Akan ışık darbeli bağlantı çizgileri. */
export function createFlowMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: sharedUniforms.uTime, uOpacity: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aT;
      attribute vec3 aColor;
      attribute float aSeed;
      attribute float aSpeed;
      varying float vT; varying vec3 vColor; varying float vSeed; varying float vSpeed;
      void main() {
        vT = aT; vColor = aColor; vSeed = aSeed; vSpeed = aSpeed;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uOpacity;
      varying float vT; varying vec3 vColor; varying float vSeed; varying float vSpeed;
      void main() {
        float p = fract(vT * 2.0 - uTime * 0.35 * vSpeed + vSeed);
        float pulse = smoothstep(0.82, 0.98, p) * (1.0 - smoothstep(0.98, 1.0, p));
        float a = (0.10 + pulse * 0.95) * uOpacity;
        gl_FragColor = vec4(vColor * (0.6 + pulse * 2.4), a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** Sonsuz hissi veren, merkezden uzaklaştıkça kaybolan zemin ızgarası. */
export function createGroundMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uCell: { value: 4 }, uFade: { value: 300 }, uScanR: sharedUniforms.uScanR, uScanI: sharedUniforms.uScanI, uScanW: sharedUniforms.uScanW },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uCell; uniform float uFade; uniform float uScanR; uniform float uScanI; uniform float uScanW;
      varying vec3 vWorld;
      float grid(vec2 p, float size) {
        vec2 g = abs(fract(p / size - 0.5) - 0.5) / fwidth(p / size);
        return 1.0 - min(min(g.x, g.y), 1.0);
      }
      void main() {
        float d = length(vWorld.xz);
        float fade = 1.0 - smoothstep(uFade * 0.25, uFade, d);
        float g1 = grid(vWorld.xz, uCell) * 0.35;
        float g2 = grid(vWorld.xz, uCell * 5.0) * 0.6;
        float scan = exp(-pow((d - uScanR) / uScanW, 2.0)) * uScanI;
        vec3 col = vec3(0.18, 0.42, 1.0) * (g1 + g2) + vec3(0.25, 0.9, 1.0) * scan * 0.35;
        float a = (g1 + g2) * fade * 0.28 + scan * fade * 0.25;
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true,
    depthWrite: false,
  });
}

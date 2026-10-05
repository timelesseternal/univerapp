/* Procedural gradient: no video, image texture or external library. */
(() => {
  'use strict';
  const surfaces = Array.from(document.querySelectorAll('.aurora-backdrop'));
  if (!surfaces.length) return;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const login = document.getElementById('loginOverlay');
  const canvas = document.createElement('canvas');
  canvas.className = 'texture-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  let gl, program, uniforms, active, frame = 0;
  let elapsed = 0, previous = null, lastDraw = -Infinity;
  let ready = false, failed = false, sizeChanged = true;
  const vertexSource = `
    attribute vec2 position;
    varying vec2 uv;
    void main() {
      uv = position * 0.5 + 0.5;
      gl_Position = vec4(position, 0.0, 1.0);
    }
  `;
  const fragmentSource = `
    precision mediump float;
    varying vec2 uv;
    uniform float time;
    uniform float aspect;
    uniform vec3 tint;
    uniform float darkMode;
    float capsule(vec2 point, vec2 halfSize, float radius) {
      vec2 q = abs(point) - halfSize + radius;
      return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
    }
    void main() {
      float t = time * 0.24;
      vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
      float halfWidth = min(aspect * 0.39, 0.26);
      float distance = capsule(p, vec2(halfWidth, 0.43), min(halfWidth, 0.22));
      float shape = 1.0 - smoothstep(-0.002, 0.006, distance);
      vec2 local = vec2(p.x / max(halfWidth, 0.01), p.y / 0.43);
      float diagonal = local.y + local.x * (0.3 + 0.2 * sin(t * 0.7));
      float band = exp(-pow((diagonal - 0.65 * sin(t)) * 1.45, 2.0));
      vec2 center = vec2(0.65 * cos(t * 0.8), 0.75 * sin(t * 0.6));
      vec2 delta = (local - center) * vec2(0.8, 0.65);
      float pool = exp(-dot(delta, delta) * 2.0);
      float light = clamp(band * 0.48 + pool * 0.42, 0.0, 1.0);
      float pearl = smoothstep(0.4, 1.0, light) * 0.36;
      vec3 color = mix(tint * 0.82, vec3(0.84, 0.84, 0.89), pearl);
      vec3 darkCapsule = mix(vec3(0.006, 0.007, 0.012), color, light);
      vec3 lightCapsule = mix(vec3(0.89, 0.91, 0.94), mix(tint, vec3(1.0), 0.52), light);
      vec3 background = mix(vec3(0.94, 0.95, 0.97), vec3(0.026, 0.029, 0.037), darkMode);
      vec3 inside = mix(lightCapsule, darkCapsule, darkMode);
      float halo = exp(-max(distance, 0.0) * 17.0) * (1.0 - shape) * 0.055;
      gl_FragColor = vec4(mix(background, inside, shape) + tint * halo, 1.0);
    }
  `;
  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0; previous = null;
    surfaces.forEach(surface => surface.classList.remove('webgl-ready'));
  }
  function fallback() {
    ready = false; failed = true; stop(); canvas.remove();
    if (gl && program) gl.deleteProgram(program);
  }
  function shader(type, source) {
    const compiled = gl.createShader(type);
    if (!compiled) throw new Error('Shader unavailable');
    gl.shaderSource(compiled, source); gl.compileShader(compiled);
    if (!gl.getShaderParameter(compiled, gl.COMPILE_STATUS)) {
      gl.deleteShader(compiled); throw new Error('Shader compilation failed');
    }
    return compiled;
  }
  function setup() {
    try {
      gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
      if (!gl) { fallback(); return; }
      const vertex = shader(gl.VERTEX_SHADER, vertexSource), fragment = shader(gl.FRAGMENT_SHADER, fragmentSource);
      program = gl.createProgram();
      gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      gl.deleteShader(vertex); gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader linking failed');
      gl.useProgram(program);
      const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'position');
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      uniforms = Object.fromEntries(['time', 'aspect', 'tint', 'darkMode'].map(name => [name, gl.getUniformLocation(program, name)]));
      sizeChanged = true; lastDraw = -Infinity; ready = true; failed = false; resume();
    } catch (error) { fallback(); }
  }
  function chooseSurface() {
    const visible = login && !login.classList.contains('hidden') && getComputedStyle(login).display !== 'none';
    const next = visible ? surfaces.find(surface => login.contains(surface)) : surfaces.find(surface => !login || !login.contains(surface));
    if (next && next !== active) {
      if (active) active.classList.remove('webgl-ready');
      active = next; active.appendChild(canvas); sizeChanged = true;
    }
  }
  function draw(timestamp) {
    frame = 0;
    if (!ready || failed || motion.matches || document.hidden) { stop(); return; }
    chooseSurface(); if (!active) return;
    if (previous !== null) elapsed += Math.min(timestamp - previous, 100) / 1000;
    previous = timestamp;
    if (timestamp - lastDraw >= 1000 / 30) {
      const width = active.clientWidth, height = active.clientHeight;
      if (width && height) {
        try {
          if (sizeChanged) {
            const scale = Math.min(window.devicePixelRatio || 1, 1.25, 1024 / Math.max(width, height));
            canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
            gl.viewport(0, 0, canvas.width, canvas.height); gl.uniform1f(uniforms.aspect, width / height); sizeChanged = false;
          }
          const rgb = getComputedStyle(active).getPropertyValue('--background-tint-rgb').trim().split(',').map(Number);
          const tint = rgb.length === 3 && rgb.every(Number.isFinite) ? rgb : [105, 77, 202];
          gl.uniform3f(uniforms.tint, tint[0] / 255, tint[1] / 255, tint[2] / 255);
          gl.uniform1f(uniforms.darkMode, document.documentElement.getAttribute('data-theme') === 'dark' ? 1 : 0);
          gl.uniform1f(uniforms.time, elapsed); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          active.classList.add('webgl-ready'); lastDraw = timestamp;
        } catch (error) { fallback(); return; }
      }
    }
    frame = requestAnimationFrame(draw);
  }
  function resume() {
    if (motion.matches || document.hidden || failed) { stop(); return; }
    if (ready && !frame) frame = requestAnimationFrame(draw);
  }
  function refreshMotion() {
    if (motion.matches) stop(); else if (!ready && !failed) setup(); else resume();
  }
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); ready = false; stop(); });
  canvas.addEventListener('webglcontextrestored', () => { if (!motion.matches) setup(); });
  window.addEventListener('resize', () => { sizeChanged = true; });
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('pagehide', stop); window.addEventListener('pageshow', resume);
  if (motion.addEventListener) motion.addEventListener('change', refreshMotion); else if (motion.addListener) motion.addListener(refreshMotion);
  if (window.ResizeObserver) { const resize = new ResizeObserver(() => { sizeChanged = true; }); surfaces.forEach(surface => resize.observe(surface)); }
  if (!motion.matches) setup();
})();

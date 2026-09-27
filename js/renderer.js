// Minimal WebGL 2 layer: one program, two data textures, one draw call.

import { VERT, FRAG } from './shaders.js';

export class Renderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL 2 is not available in this browser.');
    this.gl = gl;
    this.lost = false;
    this.ready = false;
    this.onRestored = null;

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
      this.ready = false;
    });
    canvas.addEventListener('webglcontextrestored', async () => {
      await this.init();
      this.lost = false;
      this.onRestored?.();
    });
  }

  /** Compiles the program (in parallel when the driver allows) and creates textures. */
  async init() {
    const gl = this.gl;
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);

    const par = gl.getExtension('KHR_parallel_shader_compile');
    if (par) {
      while (!gl.getProgramParameter(prog, par.COMPLETION_STATUS_KHR)) {
        await new Promise((r) => setTimeout(r, 16));
      }
    }
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = [gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs), gl.getProgramInfoLog(prog)]
        .filter(Boolean).join('\n');
      throw new Error('Shader compilation failed:\n' + log);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    this.program = prog;
    this.uniforms = collectUniforms(gl, prog);
    this.cellTex = makeTexture(gl);
    this.colorTex = makeTexture(gl);
    this.texW = this.texH = 0;

    gl.useProgram(prog);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.set('uCells', 0);
    this.set('uColors', 1);
    this.ready = true;
  }

  /** Uploads the per-cell data. Colours only when they changed. */
  upload(field, colors) {
    const gl = this.gl;
    const { W, H } = field;
    const resized = W !== this.texW || H !== this.texH;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.cellTex);
    if (resized) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, H, 0, gl.RGBA, gl.FLOAT, field.cells);
    else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.FLOAT, field.cells);
    if (colors || resized) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.colorTex);
      if (resized) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, field.color);
      else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, field.color);
    }
    this.texW = W;
    this.texH = H;
  }

  resize(w, h) {
    const c = this.canvas;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
  }

  set(name, v) {
    const u = this.uniforms[name];
    if (u) u.set(v);
  }

  draw(values) {
    if (!this.ready || this.lost) return;
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    for (const k in values) this.set(k, values[k]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.cellTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.colorTex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  get maxSize() {
    const d = this.gl.getParameter(this.gl.MAX_VIEWPORT_DIMS);
    return Math.min(d[0], d[1], this.gl.getParameter(this.gl.MAX_RENDERBUFFER_SIZE));
  }
}

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  return s;
}

function makeTexture(gl) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

/** Builds name -> setter for every active uniform, dispatching on its GL type. */
function collectUniforms(gl, prog) {
  const out = {};
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(prog, i);
    const loc = gl.getUniformLocation(prog, info.name);
    let set;
    switch (info.type) {
      case gl.FLOAT: set = (v) => gl.uniform1f(loc, v); break;
      case gl.FLOAT_VEC2: set = (v) => gl.uniform2fv(loc, v); break;
      case gl.FLOAT_VEC3: set = (v) => gl.uniform3fv(loc, v); break;
      case gl.FLOAT_VEC4: set = (v) => gl.uniform4fv(loc, v); break;
      case gl.FLOAT_MAT3: set = (v) => gl.uniformMatrix3fv(loc, false, v); break;
      case gl.INT:
      case gl.BOOL:
      case gl.SAMPLER_2D: set = (v) => gl.uniform1i(loc, +v); break;
      default: continue;
    }
    out[info.name] = { loc, set };
  }
  return out;
}

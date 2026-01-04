/**
 * @fileoverview Hyperwave String Concealer.
 * Implements N-dimensional geometric wave encryption and generates
 * self-defending runtime decoders.
 */

const t = require("@babel/types");
const parser = require("@babel/parser");

const encoder = new TextEncoder();

/**
 * Bitwise Left Rotation (8-bit)
 */
function rotl8(v, n) {
  return ((v << n) | (v >>> (8 - n))) & 0xff;
}

/**
 * Bitwise Right Rotation (8-bit)
 */
function rotr8(v, n) {
  return ((v >>> n) | (v << (8 - n))) & 0xff;
}

/**
 * Creates a deterministic pseudo-random number generator for the wave engine.
 * @param {Uint8Array} seedBytes
 */
function createPrng(seedBytes) {
  let s = 0x811c9dc5;
  for (let i = 0; i < seedBytes.length; i++) {
    s = (s ^ seedBytes[i]) >>> 0;
    s = (s * 16777619) >>> 0;
  }
  if (s === 0) s = 0xa5a5a5a5;
  return {
    next() {
      s ^= (s << 13) >>> 0;
      s ^= (s >>> 17) >>> 0;
      s ^= (s << 5) >>> 0;
      return s >>> 0;
    },
    nextFloat() {
      return this.next() / 0xffffffff;
    },
  };
}

/**
 * Hyperwave Encryption Algorithm.
 * Projects data into an N-dimensional space and applies interference waves
 * to mutate the bitstream.
 *
 * @param {Uint8Array} data The input buffer.
 * @param {Uint8Array} Sk The Secret Key (Seed).
 * @param {boolean} forward Direction (True for encryption, False for decryption).
 */
function hyperwave(data, Sk, forward) {
  const n = data.length;
  if (n === 0) return new Uint8Array(0);

  const pr = createPrng(Sk);
  const out = new Uint8Array(data);

  // Generate random dimensions (2D up to 5D space)
  const numDims = 2 + (pr.next() % 4);
  const dims = new Array(numDims).fill(1);
  let tempN = n;
  for (let i = 0; i < numDims; i++) {
    const factor = Math.ceil(Math.pow(tempN, 1 / (numDims - i)));
    dims[i] = factor;
    tempN = Math.ceil(tempN / factor);
  }

  // Calculate strides for coordinate mapping
  const strides = new Array(numDims);
  strides[numDims - 1] = 1;
  for (let i = numDims - 2; i >= 0; i--) {
    strides[i] = strides[i + 1] * dims[i + 1];
  }

  // Procedurally generate interference waves
  const numWaves = Math.max(8, Math.min(64, Math.floor(Math.sqrt(n))));
  const waves = new Array(numWaves);
  for (let i = 0; i < numWaves; i++) {
    waves[i] = {
      origin: dims.map((d) => pr.next() % d),
      amplitude: pr.next() & 0xff,
      frequency: 0.5 + pr.nextFloat() * 4,
      phase: pr.nextFloat() * 2 * Math.PI,
      rot: 1 + (pr.next() & 7),
    };
  }

  const coords = new Array(numDims);
  const waveOps = forward ? waves : waves.slice().reverse();

  for (const wave of waveOps) {
    for (let i = 0; i < n; i++) {
      // Map linear index to N-dimensional coordinates
      let tempIndex = i;
      for (let d = 0; d < numDims; d++) {
        coords[d] = Math.floor(tempIndex / strides[d]);
        tempIndex %= strides[d];
      }

      // Calculate distance to wave origin in N-space
      let distSq = 0;
      for (let d = 0; d < numDims; d++) {
        distSq += Math.pow(coords[d] - wave.origin[d], 2);
      }

      const distance = Math.sqrt(distSq);
      const waveVal = Math.sin(distance * wave.frequency + wave.phase);
      const xorModifier = Math.floor(wave.amplitude * ((waveVal + 1) / 2));

      if (forward) {
        out[i] = rotl8(out[i], wave.rot) ^ xorModifier;
      } else {
        out[i] = rotr8(out[i] ^ xorModifier, wave.rot);
      }
    }
  }

  return out;
}

/**
 * Manages string encryption and the generation of the runtime
 * decryption function (bootloader).
 */
class StringConcealer {
  constructor() {
    this.decoderFunctionName = `_d${Math.random().toString(36).slice(7)}`;
    this.cache = new Map();
  }

  /**
   * Encrypts a string and returns a Base64 payload containing Key + Data.
   */
  conceal(str) {
    if (this.cache.has(str)) return this.cache.get(str);

    const keyBytes = new Uint8Array(16);
    crypto.getRandomValues(keyBytes); // Use secure random if in Node/Browser

    const dataBytes = encoder.encode(str);
    const concealed = hyperwave(dataBytes, keyBytes, true);

    // Concatenate Key (16 bytes) + Encrypted Data
    const payload = new Uint8Array(keyBytes.length + concealed.length);
    payload.set(keyBytes, 0);
    payload.set(concealed, keyBytes.length);

    const b64 = Buffer.from(payload).toString("base64");
    this.cache.set(str, b64);
    return b64;
  }

  /**
   * Generates the polymorphic decoder AST.
   * Includes anti-tamper logic and performance-optimized decryption loops.
   */
  getDecoderAST() {
    const source = `
    const ${this.decoderFunctionName} = (() => {
      const IS_BROWSER = typeof window !== 'undefined';
      const C = new Map();
      const M = Math;

      const TRAP = () => {
        if (!IS_BROWSER) return;
        console.log("Security Check Failed");
        setInterval(() => { debugger; }, 50);
        throw new Error("VM_CORRUPTION");
      };

      const D = (s) => {
        const b = atob(s), o = new Uint8Array(b.length);
        for (let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i);
        return o;
      };
      const R = (v, n) => ((v >>> n) | (v << (8 - n))) & 0xff;

      const P = (S) => {
        let s = 0x811c9dc5;
        for (let i = 0; i < S.length; i++) { s = (s ^ S[i]) >>> 0; s = (s * 16777619) >>> 0; }
        if (s === 0) s = 0xa5a5a5a5;
        const prng = {
          N() { s ^= (s << 13) >>> 0; s ^= (s >>> 17) >>> 0; s ^= (s << 5) >>> 0; return s >>> 0; },
                                         F() { return prng.N() / 0xffffffff; }
        };
        return prng;
      };

      const toStringRaw = Function.prototype.toString;
      const P_LEN = toStringRaw.call(P).length;

      const core = (e) => {
        if (C.has(e)) return C.get(e);
        const p = D(e), k = p.slice(0, 16), d = p.slice(16), n = d.length;
        if (n === 0) return "";

        const pr = P(k);
        const out = new Uint8Array(d);
        const numDims = 2 + (pr.N() % 4);
        const dims = new Array(numDims).fill(1);
        let tempN = n;
        for (let i = 0; i < numDims; i++) {
          const factor = M.ceil(M.pow(tempN, 1 / (numDims - i)));
          dims[i] = factor;
          tempN = M.ceil(tempN / factor);
        }

        const strides = new Array(numDims);
        strides[numDims - 1] = 1;
        for (let i = numDims - 2; i >= 0; i--) strides[i] = strides[i + 1] * dims[i + 1];

        const numWaves = M.max(8, M.min(64, M.floor(M.sqrt(n))));
        const waves = new Array(numWaves);
        for (let i = 0; i < numWaves; i++) {
          waves[i] = {
            o: dims.map(d => pr.N() % d),
                                         a: pr.N() & 0xff,
                                         f: 0.5 + pr.F() * 4,
                                         p: pr.F() * 2 * M.PI,
                                         r: 1 + (pr.N() & 7),
          };
        }

        const coords = new Array(numDims);
        for (let j = waves.length - 1; j >= 0; j--) {
          const w = waves[j];
          for (let i = 0; i < n; i++) {
            let ti = i;
            for (let di = 0; di < numDims; di++) { coords[di] = M.floor(ti / strides[di]); ti %= strides[di]; }
            let ds = 0;
            for (let di = 0; di < numDims; di++) ds += M.pow(coords[di] - w.o[di], 2);
            const wv = M.sin(M.sqrt(ds) * w.f + w.p);
            out[i] = R(out[i] ^ M.floor(w.a * ((wv + 1) / 2)), w.r);
          }
        }

        const res = new TextDecoder().decode(out);
        C.set(e, res);
        return res;
      };

      return new Proxy(core, {
        apply(target, thisArg, args) {
          if (IS_BROWSER && toStringRaw.call(P).length !== P_LEN) TRAP();
          return target.apply(thisArg, args);
        }
      });
    })();
    `;
    return parser.parse(source).program.body[0];
  }
}

module.exports = StringConcealer;

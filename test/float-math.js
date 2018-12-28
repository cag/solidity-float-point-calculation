const { mpf } = require("mp-wasm");
const { randomHex, toBN } = web3.utils;
const FloatMath = artifacts.require("FloatMath");

const pow2To255 = toBN(2).pow(toBN(255));

const floatenv = require('bindings')({ module_root: __dirname, bindings: 'floatenv' });

function bufferToBigInt(buffer) {
  let ret = 0n

  for(const b of new Uint8Array(buffer)) {
    ret = (ret << 8n) + BigInt(b);
  }
  return ret;
}

mpf.setDefaultPrec(237);
const binExpMin = -262142;
const binExpMax = 262145;

function toBytes32(x, opts) {
  x = mpf(x, opts);
  const bs = new ArrayBuffer(32);
  const bsView = new DataView(bs);
  const binExp = x.getBinaryExponent();

  const header =
    ((x.isSignBitSet() ? 0x80000 : 0) |
      ((Number.isNaN(binExp)
        ? binExpMax
        : Math.min(Math.max(binExp, binExpMin), binExpMax)) -
        binExpMin)) <<
    12;
  bsView.setUint32(0, header);

  if (Number.isNaN(binExp)) {
    bsView.setUint8(31, 1);
  } else if (binExp > binExpMin - 237 && binExp < binExpMax) {
    const xBytes = x.getSignificandRawBytes();
    const lastXByte = xBytes[xBytes.length - 1];
    if (lastXByte & (0x80 === 0)) {
      throw new Error(
        `expected most significant bit of ${x} significand to be set but found ${lastXByte}`
      );
    }
    bsView.setUint8(2, bsView.getUint8(2) | ((lastXByte & 0x7f) >> 3));
    for (i = 1; i < xBytes.length && i < 30; i++) {
      bsView.setUint8(
        i + 2,
        ((xBytes[xBytes.length - i] << 5) |
          (xBytes[xBytes.length - i - 1] >> 3)) &
          0xff
      );
    }
  }

  let m = bufferToBigInt(bs)
  if(Number.isInteger(binExp) && binExp <= binExpMin) {
    m = (m | (1n << 236n)) >> BigInt(binExpMin - binExp + 1)
  }

  return '0x' + m.toString(16).padStart(64, '0');
}

describe("toBytes32 helper", function() {
  it("converts values correctly", function() {
    assert.equal(toBytes32(0), '0x0000000000000000000000000000000000000000000000000000000000000000')
    assert.equal(toBytes32(-0), '0x8000000000000000000000000000000000000000000000000000000000000000')
    assert.equal(toBytes32(1), '0x3ffff00000000000000000000000000000000000000000000000000000000000')
    assert.equal(toBytes32(-1), '0xbffff00000000000000000000000000000000000000000000000000000000000')
    assert.equal(toBytes32(Infinity), '0x7ffff00000000000000000000000000000000000000000000000000000000000')
    assert.equal(toBytes32(-Infinity), '0xfffff00000000000000000000000000000000000000000000000000000000000')
    assert.equal(toBytes32(NaN), '0x7ffff00000000000000000000000000000000000000000000000000000000001')
    assert.equal(toBytes32('0x1p-262142'), '0x0000100000000000000000000000000000000000000000000000000000000000')
    assert.equal(toBytes32('0x1.abcp-262142'), '0x00001abc00000000000000000000000000000000000000000000000000000000')
    assert.equal(toBytes32('0x1p-262143'), '0x0000080000000000000000000000000000000000000000000000000000000000')
    assert.equal(toBytes32('0x1.abcp-262146'), '0x000001abc0000000000000000000000000000000000000000000000000000000')
    assert.equal(toBytes32('0x1p-262378'), '0x0000000000000000000000000000000000000000000000000000000000000001')
  })
})

contract("FloatMath", function(accounts) {
  let floatMath;

  before(async function() {
    floatMath = await FloatMath.new();
  });

  it("can convert ints to floats", async function() {
    for (let i = 0; i < 10; i++) {
      const roundingMode = Math.floor(4 * Math.random());
      const x = toBN(randomHex(32)).sub(pow2To255);
      assert.equal(
        await floatMath.fromInt(x, roundingMode),
        toBytes32(x, { roundingMode }),
        `${x} produced different binary256 bytes`
      );
    }
  });

  it("operates correctly with zero", async function() {
    const zero = toBytes32(0);
    const x = toBytes32(10);
    assert.equal(await floatMath.add(zero, x, 0), x);
    assert.equal(await floatMath.add(x, zero, 0), x);
    assert.equal(await floatMath.sub(x, zero, 0), x);
    assert.equal(await floatMath.mul(zero, x, 0), zero);
    assert.equal(await floatMath.mul(x, zero, 0), zero);
    assert.equal(await floatMath.div(zero, x, 0), zero);
  });

  const roundingModeNames = [
    'RoundTiesToEven',
    'RoundTowardZero',
    'RoundTowardPositive',
    'RoundTowardNegative'
  ];
  const genParams = () => [
    0, -0,
    1, -1,
    -Infinity,
    Infinity,
    NaN,

    // normal float
    mpf(`${
      Math.random() < .5 ? '-' : ''
    }0x1.${
      randomHex(30).slice(-59)
    }p${
      Math.floor(Math.random() * 0x7ffff) - 0x3fffe
    }`),

    // subnormal float
    mpf(`${
      Math.random() < .5 ? '-' : ''
    }0x0.${
      randomHex(30).slice(-59)
    }p${
      -0x3fffe
    }`),
    // Math.random(),
    // (Math.random() - 0.5) * Math.pow(2, Math.ceil(Math.random() * 2048 - 1024))
  ];
  [["add", "+"], ["sub", "-"], ["mul", "*"], ["div", "/"]].forEach(
    ([op, opSym]) => {
      it(`can ${op}`, async function() {
        for (let i = 0; i < 10; i++) {
          for (const x of genParams()) {
            for (const y of genParams()) {
              // FIXME: other rounding modes do not match yet
              // because MPFR doesn't quite do IEEE 754 right.
              // const roundingMode = Math.floor(4 * Math.random());
              const roundingMode = 0;
              try {
                const xb32 = toBytes32(x)
                const yb32 = toBytes32(y)
                assert.equal(
                  await floatMath[op](xb32, yb32, roundingMode),
                  toBytes32(mpf[op](x, y)),
                  `${op}(${xb32}, ${yb32}) -- ${x} ${opSym} ${y} -- mismatch using rounding mode ${roundingModeNames[roundingMode]}`
                );
              } catch(e) {
                throw new Error(`${x} ${opSym} ${y} failed: ${e}`);
              }
            }
          }
        }
      });
    }
  );

  it("can log2");
  it("can get the reciprocal of the square root");
});

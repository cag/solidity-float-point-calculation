const { mpf } = require("mp-wasm");
const { randomHex, toBN } = web3.utils;
const UintMath = artifacts.require("UintMath");
const FloatMath = artifacts.require("FloatMath");

const pow2To255 = toBN(2).pow(toBN(255));

const floatenv = require("bindings")({
  module_root: __dirname,
  bindings: "floatenv"
});

function bufferToBigInt(buffer) {
  let ret = 0n;

  for (const b of new Uint8Array(buffer)) {
    ret = (ret << 8n) + BigInt(b);
  }
  return ret;
}

mpf.setDefaultPrec(256);
const binExpMin = -262142;
const binExpMax = 262145;

let lastGRS;
function toBytes32(x, opts) {
  x = mpf(x, opts);
  const roundingMode = (opts && opts.roundingMode) || 0;
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

  let grs = 0;
  if (Number.isNaN(binExp)) {
    // this is the only NaN used
    return "0x7ffff00000000000000000000000000000000000000000000000000000000001";
  } else if (Number.isFinite(binExp) && binExp < binExpMax) {
    const xBytes = x.getSignificandRawBytes();
    const lastXByte = xBytes[xBytes.length - 1];
    if (lastXByte & (0x80 === 0)) {
      throw new Error(
        `expected most significant bit of ${x} significand to be set but found ${lastXByte}`
      );
    }
    bsView.setUint8(2, bsView.getUint8(2) | ((lastXByte & 0x7f) >> 3));
    let i;
    for (i = 1; i < xBytes.length && i < 30; i++) {
      bsView.setUint8(
        i + 2,
        ((xBytes[xBytes.length - i] << 5) |
          (xBytes[xBytes.length - i - 1] >> 3)) &
          0xff
      );
    }

    if (i < xBytes.length) grs = xBytes[xBytes.length - i] & 7;

    for (i++; grs & (1 === 0) && i < xBytes.length; i++) {
      if (xBytes[xBytes.length - i] != 0) grs |= 1;
    }
  }

  let m = bufferToBigInt(bs);
  const s = m & (1n << 255n);
  if (Number.isFinite(binExp) && binExp <= binExpMin) {
    const rshift = BigInt(binExpMin - binExp + 1);
    console.log(m.toString(16), "rshift", rshift);
    if (grs === 0 && (m & ((1n << (rshift - 3n)) - 1n)) === 0n)
      grs = Number((m >> (rshift - 3n)) & 7n);
    else grs = Number((m >> (rshift - 3n)) & 7n) | 1;

    m = (((m ^ s) | (1n << 236n)) >> rshift) ^ s;
  } else {
    console.log(m.toString(16), "grs", grs);
  }

  if (
    x.lgt(0) &&
    Number.isFinite(binExp) &&
    binExp < binExpMax &&
    !(
      ((roundingMode === 0 || roundingMode === "roundTiesToEven") &&
        ((grs & 4) === 0 || ((grs & 3) === 0 && (m & 1n) === 0n))) ||
      (roundingMode === 1 || roundingMode === "roundTowardZero") ||
      ((roundingMode === 2 || roundingMode === "roundTowardPositive") &&
        (s !== 0 || grs === 0)) ||
      ((roundingMode === 3 || roundingMode === "roundTowardNegative") &&
        (s === 0 || grs === 0))
    )
  ) {
    m++;
  }
  lastGRS = grs;

  return "0x" + m.toString(16).padStart(64, "0");
}

describe("toBytes32 helper", function() {
  it("converts values correctly", function() {
    assert.equal(
      toBytes32(0),
      "0x0000000000000000000000000000000000000000000000000000000000000000"
    );
    assert.equal(
      toBytes32(-0),
      "0x8000000000000000000000000000000000000000000000000000000000000000"
    );
    assert.equal(
      toBytes32(1),
      "0x3ffff00000000000000000000000000000000000000000000000000000000000"
    );
    assert.equal(
      toBytes32(-1),
      "0xbffff00000000000000000000000000000000000000000000000000000000000"
    );
    assert.equal(
      toBytes32(Infinity),
      "0x7ffff00000000000000000000000000000000000000000000000000000000000"
    );
    assert.equal(
      toBytes32(-Infinity),
      "0xfffff00000000000000000000000000000000000000000000000000000000000"
    );
    assert.equal(
      toBytes32(NaN),
      "0x7ffff00000000000000000000000000000000000000000000000000000000001"
    );
    assert.equal(
      toBytes32("0x1p-262142"),
      "0x0000100000000000000000000000000000000000000000000000000000000000"
    );
    assert.equal(
      toBytes32("0x1.abcp-262142"),
      "0x00001abc00000000000000000000000000000000000000000000000000000000"
    );
    assert.equal(
      toBytes32("0x1p-262143"),
      "0x0000080000000000000000000000000000000000000000000000000000000000"
    );
    assert.equal(
      toBytes32("0x1.abcp-262146"),
      "0x000001abc0000000000000000000000000000000000000000000000000000000"
    );
    assert.equal(
      toBytes32("0x1p-262378"),
      "0x0000000000000000000000000000000000000000000000000000000000000001"
    );
    assert.equal(
      toBytes32("-0x1p-262378"),
      "0x8000000000000000000000000000000000000000000000000000000000000001"
    );
  });
});

contract("UintMath", function(accounts) {
  let uintMath;

  before(async function() {
    uintMath = await UintMath.new();
  });

  it("can get bit length of uint", async function() {
    assert.equal((await uintMath.bitLength(0)).toNumber(), 0);
    assert.equal((await uintMath.bitLength(1)).toNumber(), 1);
    assert.equal((await uintMath.bitLength(2)).toNumber(), 2);
    assert.equal((await uintMath.bitLength(3)).toNumber(), 2);
    assert.equal((await uintMath.bitLength(4)).toNumber(), 3);
    assert.equal((await uintMath.bitLength(toBN(0).notn(256))).toNumber(), 256);
    const randWidth = Math.floor(Math.random() * 256);
    assert.equal(
      (await uintMath.bitLength(toBN(0).notn(randWidth))).toNumber(),
      randWidth
    );
    assert.equal(
      (await uintMath.bitLength(toBN(0).bincn(randWidth))).toNumber(),
      randWidth + 1
    );
    const x = toBN(randomHex(32));
    assert.equal((await uintMath.bitLength(x)).toNumber(), x.bitLength());
  });
});

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
    "roundTiesToEven",
    "roundTowardZero",
    "roundTowardPositive",
    "roundTowardNegative"
  ];
  const genParams = () =>
    [
      0,
      -0,
      1,
      -1,
      -Infinity,
      Infinity,
      NaN,

      Array.from({ length: 10 }, () => [
        // normal float
        mpf(
          `${Math.random() < 0.5 ? "-" : ""}0x1.${randomHex(30).slice(
            -59
          )}p${Math.floor(Math.random() * 0x7ffff) - 0x3fffe}`
        ),

        // subnormal float
        mpf(
          `${Math.random() < 0.5 ? "-" : ""}0x0.${randomHex(30).slice(
            -59
          )}p${-0x3fffe}`
        )
      ])
    ].flat(2);
  [["add", "+"], ["sub", "-"], ["mul", "*"], ["div", "/"]].forEach(
    ([op, opSym]) => {
      it(`can ${op}`, async function() {
        for (const x of genParams()) {
          for (const y of genParams()) {
            const roundingMode = Math.floor(4 * Math.random());
            try {
              const xb32 = toBytes32(x);
              const yb32 = toBytes32(y);
              const mpfOpts = {
                roundingMode
              };
              assert.equal(
                await floatMath[op](xb32, yb32, roundingMode),
                toBytes32(mpf[op](x, y, mpfOpts), mpfOpts),
                `${x} ${opSym} ${y}
      ${op}(${xb32}, ${yb32})
      mismatch using rounding mode ${roundingModeNames[roundingMode]}
      grs ${lastGRS}`
              );
            } catch (e) {
              if (e.constructor.name === "AssertionError") throw e;
              else throw new Error(`${x} ${opSym} ${y} failed: ${e}`);
            }
          }
        }
      });
    }
  );

  it("can log2");
  it("can get the reciprocal of the square root");
});

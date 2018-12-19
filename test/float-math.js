const { mpf } = require("mp-wasm");
const { randomHex, toBN } = web3.utils;
const FloatMath = artifacts.require("FloatMath");

const pow2To255 = toBN(2).pow(toBN(255));

// https://stackoverflow.com/a/50767210
function bufferToHex(buffer) {
  return (
    "0x" +
    Array.from(new Uint8Array(buffer))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

mpf.setDefaultPrec(237);
mpf.setDefaultRoundingMode("roundTowardZero");
const binExpMin = -262142;
const binExpMax = 262145;

function toBytes32(x) {
  x = mpf(x);
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
  } else if (binExp > binExpMin && binExp < binExpMax) {
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
  return bufferToHex(bs);
}

contract("FloatMath", function(accounts) {
  let floatMath;

  before(async function() {
    floatMath = await FloatMath.new();
  });

  it("can encode and decode", async function() {
    for (let i = 0; i < 10; i++) {
      const x = toBN(randomHex(32)).sub(pow2To255);
      assert.equal(
        await floatMath.initFromInt(x),
        toBytes32(x),
        `${x} produced different binary256 bytes`
      );
    }
  });

  it("operates correctly with zero", async function() {
    const zero = toBytes32(0);
    const x = toBytes32(10);
    assert.equal(await floatMath.add(zero, x), x);
    assert.equal(await floatMath.add(x, zero), x);
    assert.equal(await floatMath.sub(x, zero), x);
    assert.equal(await floatMath.mul(zero, x), zero);
    assert.equal(await floatMath.mul(x, zero), zero);
    assert.equal(await floatMath.div(zero, x), zero);
  });

  it("can add, sub, mul, and div", async function() {
    const genParams = () => [
      -Infinity,
      Infinity,
      NaN,
      0,
      -1,
      1,
      Math.random(),
      (Math.random() - 0.5) *
        Math.pow(2, Math.ceil(Math.random() * 2048 - 1024))
    ];
    for (let i = 0; i < 10; i++) {
      for (const [op, opSym] of [
        ["add", "+"],
        ["sub", "-"],
        ["mul", "*"],
        ["div", "/"]
      ]) {
        for (const x of genParams())
          for (const y of genParams())
            assert.equal(
              await floatMath[op](toBytes32(x), toBytes32(y)),
              toBytes32(mpf[op](x, y)),
              `${x} ${opSym} ${y} mismatch`
            );
      }
    }
  });

  it("can log2");
  it("can get the reciprocal of the square root");
});

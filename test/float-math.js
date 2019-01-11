const bf = require("big-float-wasm");
const { randomHex, toBN } = web3.utils;
const UintMath = artifacts.require("UintMath");
const FloatMath = artifacts.require("FloatMath");

const pow2To255 = toBN(2).pow(toBN(255));

bf.defaultPrecision = 237;
bf.defaultExpnBits = 19;

function toBytes32(x, opts) {
  x = bf(x, opts)
  return x.toIEEE754Hex(opts)
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
      "0x7ffff80000000000000000000000000000000000000000000000000000000000"
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

  const roundingModeNames = [
    "roundTiesToEven",
    "roundTowardZero",
    "roundTowardPositive",
    "roundTowardNegative"
  ];

  it("can convert ints to floats", async function() {
    for (let i = 0; i < 10; i++) {
      const roundingMode = Math.floor(4 * Math.random());
      const x = toBN(randomHex(32)).sub(pow2To255);
      assert.equal(
        await floatMath.fromInt(x, roundingMode),
        toBytes32(x, { roundingMode: roundingModeNames[roundingMode] }),
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
        // bf(
          `${Math.random() < 0.5 ? "-" : ""}0x1.${randomHex(30).slice(
            -59
          )}p${Math.floor(Math.random() * 0x7ffff) - 0x3fffe}`
        // ),
        ,
        // subnormal float
        // bf(
          `${Math.random() < 0.5 ? "-" : ""}0x0.${randomHex(30).slice(
            -59
          )}p${-0x3fffe}`
        // )
      ])
    ].flat(2);
  [["add", "+"], ["sub", "-"], ["mul", "*"], ["div", "/"]].forEach(
    ([op, opSym]) => {
      it(`can ${op}`, async function() {
        for (const x of genParams()) {
          for (const y of genParams()) {
            const roundingMode = Math.floor(4 * Math.random());
            try {
              const xbf = bf(x)
              const ybf = bf(y)
              const xb32 = xbf.toIEEE754Hex();
              const yb32 = ybf.toIEEE754Hex();

              assert.equal(
                await floatMath[op](xb32, yb32, roundingMode),
                xbf[op](ybf, { roundingMode: roundingModeNames[roundingMode] }).toIEEE754Hex(),
                `${x} ${opSym} ${y}
      ${op}(${xb32}, ${yb32})
      mismatch using rounding mode ${roundingModeNames[roundingMode]}`
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

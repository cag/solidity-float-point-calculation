const { mpf } = require("mp-wasm")
const FloatMath = artifacts.require("FloatMath")

contract('FloatMath', function(accounts) {
    let floatMath

    before(async function() {
        floatMath = await FloatMath.new()
    })

    it('can encode and decode', async function() {
        console.log(await floatMath.initFromInt(0))
        console.log(await floatMath.initFromInt(10))
        console.log(await floatMath.initFromInt(-7))
    })

    it('operates correctly with zero', async function() {
        const zero = await floatMath.initFromInt(0)
        const x = await floatMath.initFromInt(10)
        assert.equal(await floatMath.add(zero, x), x)
        assert.equal(await floatMath.add(x, zero), x)
        assert.equal(await floatMath.sub(x, zero), x)
        assert.equal(await floatMath.mul(zero, x), zero)
        assert.equal(await floatMath.mul(x, zero), zero)
        assert.equal(await floatMath.div(zero, x), zero)
    })

    it('can add')
    it('can sub')
    it('can mul')
    it('can div')
    it('can log2')
    it('can get the reciprocal of the square root')
})

pragma solidity ^0.5.1;

library UintMath {
    function _bitLength(uint x) internal pure returns (uint) {
        uint l = 0;
        uint r = 256;
        while(l != r) {
            uint m = (l + r) / 2;
            if(x >> m == 0) {
                r = m;
            } else {
                l = m + 1;
            }
        }
        return l;
    }

    function bitLength(uint x) external pure returns (uint) {
        return _bitLength(x);
    }

    // I adapted this from Fast Division of Large Integers by Karl Hasselström
    // Algorithm 3.4: Divide-and-conquer division (3 by 2)
    // Karl got it from Burnikel and Ziegler and the GMP lib implementation
    function _div256_zero128By256(uint a21, uint b)
        internal
        pure
        returns (uint q, uint r)
    {
        uint qhi = (a21 / b) << 128;
        a21 %= b;

        uint shift = 256 - _bitLength(b);
        a21 = (a21 << shift);
        b <<= shift;
        uint b0 = b & 2**128-1;
        b >>= 128;

        uint rhi;
        q = a21 / b;
        rhi = a21 % b;

        uint rsub0 = (q & 2**128-1) * b0;
        uint rsub21 = (q >> 128) * b0 + (rsub0 >> 128);
        rsub0 &= 2**128-1;

        uint a0 = 0;
        while(rsub21 > rhi || rsub21 == rhi && rsub0 > a0) {
            q--;
            a0 += b0;
            rhi += b + (a0 >> 128);
            a0 &= 2**128-1;
        }

        q += qhi;
        r = (((rhi - rsub21) << 128) + a0 - rsub0) >> shift;
        return (q, r);
    }
}

library FloatMath {
    // https://ethereum.stackexchange.com/a/45488 on why rnd is a uint everywhere
    enum RoundingMode {
        RoundTiesToEven,
        RoundTowardZero,
        RoundTowardPositive,
        RoundTowardNegative
    }
    uint constant NUM_ROUNDING_MODES = uint(RoundingMode.RoundTowardNegative) + 1;

    uint constant S_MASK = 1 << 255;
    uint constant E_MAX = 0x7ffff;
    uint constant E_BIAS = 0x3ffff;
    uint constant E_SHIFT = 236;
    uint constant E_MASK = E_MAX << E_SHIFT;
    uint constant F_LIMIT = (1 << E_SHIFT);
    uint constant F_MASK = F_LIMIT - 1;

    // http://pages.cs.wisc.edu/~markhill/cs354/Fall2008/notes/flpt.apprec.html
    // see: on Rounding
    uint constant FGRS_LENGTH = E_SHIFT + 3;
    uint constant FGRS_LIMIT = 1 << FGRS_LENGTH;
    uint constant FGRS_MASK = FGRS_LIMIT - 1;

    function toParts(bytes32 x) internal pure returns (uint s, uint e, uint f) {
        e = (uint(x) & E_MASK) >> E_SHIFT;
        f = uint(x) & F_MASK;
        if(e > 0)
            f |= F_LIMIT;
        else if(f != 0)
            e = 1;

        return (uint(x) & S_MASK, e, f);
    }

    function normalizeInternal(uint s, uint e, uint fgrs, uint rnd) internal pure returns (bytes32) {
        require(rnd < NUM_ROUNDING_MODES, "unsupported rounding mode");
        if(e >= E_MAX)
            return bytes32(s | E_MASK);

        if(fgrs == 0)
            return bytes32(s);

        while(fgrs >= FGRS_LIMIT * 2 && e < E_MAX) {
            fgrs = (fgrs >> 1) | (fgrs & 1);
            e++;
        }
        while(fgrs < FGRS_LIMIT && e > 1) {
            fgrs <<= 1;
            e--;
        }
        if(fgrs < FGRS_LIMIT && e == 1) {
            e = 0;
        }
        fgrs &= FGRS_MASK;

        if(
            // https://stackoverflow.com/a/8984135
            (RoundingMode(rnd) == RoundingMode.RoundTiesToEven && (fgrs & 4 == 0 || fgrs & 3 == 0 && fgrs & 8 == 0)) ||
            (RoundingMode(rnd) == RoundingMode.RoundTowardZero) ||
            (RoundingMode(rnd) == RoundingMode.RoundTowardPositive && (s != 0 || fgrs & 7 == 0)) ||
            (RoundingMode(rnd) == RoundingMode.RoundTowardNegative && (s == 0 || fgrs & 7 == 0))
        ) {
            fgrs >>= 3;
        } else {
            fgrs = (fgrs >> 3) + 1;
            if(fgrs >= F_LIMIT && e < E_MAX) {
                fgrs &= FGRS_MASK;
                e++;
            }
        }

        if(e == E_MAX)
            fgrs = 0; // infinity

        return bytes32(s | (e << E_SHIFT) | fgrs);
    }

    function fromInt(int x, uint rnd) public pure returns (bytes32) {
        if(x == 0) {
            return bytes32(0);
        }

        uint s = uint(x) & S_MASK;
        uint f;
        if(s == 0) {
            f = uint(x);
        } else {
            f = uint(-x);
        }

        uint e = E_SHIFT + E_BIAS + 3;

        return normalizeInternal(s, e, f, rnd);
    }

    function isNaN(bytes32 x) internal pure returns (bool) {
        return uint(x) & E_MASK == E_MASK && uint(x) & F_MASK != 0;
    }

    function addParts(uint xS, uint xE, uint xF, uint yS, uint yE, uint yF, uint rnd) internal pure returns (bytes32) {
        if(xE == E_MAX && yE == E_MAX && xS != yS) {
            return bytes32(E_MASK | 1);
        }

        if(xE < yE || xE == yE && xF < yF) {
            (xS, xE, xF, yS, yE, yF) = (yS, yE, yF, xS, xE, xF);
        } else if(xS != yS && xE == yE && xF == yF) {
            if(RoundingMode(rnd) == RoundingMode.RoundTowardNegative)
                return bytes32(S_MASK);

            return bytes32(0);
        }

        if(xE == E_MAX) {
            return bytes32(xS | E_MASK);
        }

        uint dE = xE - yE;
        xF <<= 3;
        if(dE < 3)
            yF <<= (3 - dE);
        else {
            if(yF & ((1 << (dE - 3)) - 1) == 0)
                yF >>= (dE - 3);
            else
                yF = (yF >> (dE - 3)) | 1;
        }

        if(xS == yS) {
            return normalizeInternal(xS, xE, xF + yF, rnd);
        } else {
            return normalizeInternal(xS, xE, xF - yF, rnd);
        }
    }

    function add(bytes32 x, bytes32 y, uint rnd) public pure returns (bytes32) {
        if(isNaN(x)) return x;
        if(isNaN(y)) return y;

        (uint xS, uint xE, uint xF) = toParts(x);
        (uint yS, uint yE, uint yF) = toParts(y);
        return addParts(xS, xE, xF, yS, yE, yF, rnd);
    }

    function sub(bytes32 x, bytes32 y, uint rnd) public pure returns (bytes32) {
        if(isNaN(x)) return x;
        if(isNaN(y)) return y;

        (uint xS, uint xE, uint xF) = toParts(x);
        (uint yS, uint yE, uint yF) = toParts(y);
        return addParts(xS, xE, xF, yS ^ S_MASK, yE, yF, rnd);
    }

    uint constant MUL_LOW_LENGTH = E_SHIFT + 1 - 128;
    uint constant MUL_LOW_MASK = (1 << MUL_LOW_LENGTH) - 1;
    uint constant MUL_E_OFFSET = E_BIAS + 15;

    function mul(bytes32 x, bytes32 y, uint rnd) public pure returns (bytes32) {
        if(isNaN(x)) return x;
        if(isNaN(y)) return y;

        (uint xS, uint xE, uint xF) = toParts(x);
        (uint yS, uint yE, uint yF) = toParts(y);

        if(xE == 0 && yE == E_MAX || yE == 0 && xE == E_MAX)
            return bytes32(E_MASK | 1);

        if(xE == E_MAX || yE == E_MAX)
            return bytes32((xS ^ yS) | E_MASK);

        uint xF0 = (xF & MUL_LOW_MASK);
        uint yF0 = (yF & MUL_LOW_MASK);
        xF >>= MUL_LOW_LENGTH;
        yF >>= MUL_LOW_LENGTH;
        uint xyF0 = xF0 * yF0;
        uint xyF1 = (xyF0 >> MUL_LOW_LENGTH) + (xF * yF0 & MUL_LOW_MASK) + (xF0 * yF & MUL_LOW_MASK);
        xF = (xyF1 >> MUL_LOW_LENGTH) + xF * yF + (xF * yF0 >> MUL_LOW_LENGTH) + (xF0 * yF >> MUL_LOW_LENGTH);
        xyF1 &= MUL_LOW_MASK;
        xyF0 &= MUL_LOW_MASK;

        xE += yE;
        if(xE > MUL_E_OFFSET) {
            if(xyF1 != 0 || xyF0 != 0) {
                xF |= 1;
            }
            xE -= MUL_E_OFFSET;
        } else {
            if(xF != 0 || xyF1 != 0 || xyF0 != 0) {
                xE = MUL_E_OFFSET - xE + 1;
                if(xF & ((1 << xE) - 1) == 0 && xyF1 == 0 && xyF0 == 0)
                    xF >>= xE;
                else
                    xF = (xF >> xE) | 1;
            }
            xE = 1;
        }

        return normalizeInternal(xS ^ yS, xE, xF, rnd);
    }

    function div(bytes32 x, bytes32 y, uint rnd) public pure returns (bytes32) {
        if(isNaN(x)) return x;
        if(isNaN(y)) return y;

        (uint xS, uint xE, uint xF) = toParts(x);
        (uint yS, uint yE, uint yF) = toParts(y);

        if(yE == 0) {
            if(xE == 0)
                return bytes32(E_MASK | 1);

            return bytes32((xS ^ yS) | E_MASK);
        }

        if(yE == E_MAX) {
            if(xE == E_MAX) {
                return bytes32(E_MASK | 1);
            }

            return bytes32((xS ^ yS));
        }

        if(xE == 0)
            return bytes32((xS ^ yS));

        if(xE == E_MAX)
            return bytes32((xS ^ yS) | E_MASK);


        (uint q, uint r) = UintMath._div256_zero128By256(xF, yF);
        uint q0;
        (q0, r) = UintMath._div256_zero128By256(r, yF);
        q = (q << 111) + (q0 >> 17);
        if(q0 & ((1 << 17) - 1) != 0 || r != 0)
            q |= 1;

        xE += E_BIAS;
        if(xE > yE)
            return normalizeInternal(xS ^ yS, xE - yE, q, rnd);

        return normalizeInternal(xS ^ yS, 1, q >> (yE - xE), rnd);
    }
}



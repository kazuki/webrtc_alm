(function(global) {
    if (global.bigint) return;

    var bigint = function(data, radix) {
        if (typeof data === 'number') {
            if (data < 65536) {
                this.raw_ = new ArrayBuffer(2);
                this.data_ = new Uint16Array(this.raw_);
                this.data_[0] = data;
            } else {
                this.raw_ = new ArrayBuffer(4);
                this.data_ = new Uint16Array(this.raw_);
                this.data_[0] = data & 0xffff;
                this.data_[1] = data >>> 16;
            }
        } else if (data instanceof bigint) {
            this.raw_ = new ArrayBuffer(data.data_.length * 2);
            this.data_ = new Uint16Array(this.raw_);
            this.data_.set(data.data_);
        } else if (data instanceof ArrayBuffer) {
            this.raw_ = data;
            this.data_ = new Uint16Array(this.raw_);
            this.trim_();
        } else {
            console.log(data);
            console.log(typeof data);
            throw 'not implemented';
        }
    };
    bigint.prototype.clone = function() {
        return new bigint(this);
    };
    bigint.prototype.isZero = function() {
        for (var i = 0; i < this.data_.length; i++)
            if (this.data_[i] != 0)
                return false;
        return true;
    };
    bigint.prototype.trim_ = function() {
        if (this.data_.length === 1) return;
        for (var i = this.data_.length - 1; i >= 0; i--) {
            if (this.data_[i] != 0 || i === 0) {
                if (this.data_.length !== i + 1)
                    this.data_ = new Uint16Array(this.raw_, 0, i + 1);
                return;
            }
        }
    };
    bigint.prototype.add = function(y) {
        var raw = new ArrayBuffer(Math.max(this.data_.length, y.data_.length) * 2 + 2);
        var ret = new Uint16Array(raw);
        var sum = 0, i = 0;
        var x = this;
        if (x.compareTo(y) < 0) { x = y; y = this; }
        
        for (; i < y.data_.length; i ++) {
            sum += x.data_[i] + y.data_[i];
            ret[i] = sum & 0xffff;
            sum >>>= 16;
        }
        for (; i < x.data_.length; i ++) {
            sum += x.data_[i];
            ret[i] = sum & 0xffff;
            sum >>>= 16;
        }
        if (sum > 0)
            ret[i++] = sum;
        return new bigint(raw);
    };
    bigint.prototype.subtractInPlace = function(y) {
        var cmp = this.compareTo(y);
        if (cmp < 0) throw 'not supported';
        if (cmp === 0) new bigint(0);
        var i = 0;
        var carry = 0;
        for (; i < y.data_.length; i ++) {
            var tmp = y.data_[i] + carry;
            if (this.data_[i] >= tmp) {
                this.data_[i] -= tmp;
                carry = 0;
            } else {
                this.data_[i] += 0x10000 - tmp;
                carry = 1;
            }
        }
        if (carry === 1) {
            for (; i < this.data_.length; i ++) {
                if (this.data_[i] > 0) {
                    this.data_[i] --;
                    break;
                } else {
                    this.data_[i] = 0xffff;
                }
            }
        }
        this.trim_();
    };
    bigint.prototype.divideInPlace = function(y) {
        if (typeof y !== 'number') throw 'number only'
        var x = this;
        var i = x.data_.length - 1;
        var r = x.data_[i];
        x.data_[i] = Math.floor(r / y);
        r %= y;
        while (i-- > 0) {
            r <<= 16;
            r |= x.data_[i];
            x.data_[i] = Math.floor(r / y);
            r %= y;
        }
        return r;
    };
    bigint.prototype.compareTo = function(other) {
        if (typeof other === 'number') {
            if (other < 65536) {
                if (this.data_.length > 1) return 1;
                if (this.data_[0] === other) return 0;
                return -1;
            } else {
                if (this.data_.length == 1 || this.data_[1] < (other >>> 16)) return -1;
                if (this.data_[1] === (other >>> 16)) return this.compareTo (other >>> 16);
                return 1;
            }
        }
        if (other instanceof bigint) {
            if (this.data_.length > other.data_.length) return 1;
            if (this.data_.length < other.data_.length) return -1;
            for (var i = this.data_.length - 1; i >= 0; i --) {
                if (this.data_[i] < other.data_[i]) return -1;
                if (this.data_[i] > other.data_[i]) return 1;
            }
            return 0;
        }
        throw 'unknown type';
    };
    bigint.prototype.bitcount = function() {
        var count = (this.data_.length - 1) * 16;
        var x = this.data_[this.data_.length - 1];
        while (x > 0) {
            count ++;
            x >>>= 1;
        }
        return count;
    };
    bigint.prototype.toInt = function() {
        if (this.data_.length == 1)
            return this.data_[0];
        return new Uint32Array(this.raw_)[0];
    };
    bigint.prototype.toString = function(radix) {
        if (!radix) radix = 10;
        if (typeof radix !== 'number' || radix < 2 || radix > 16) throw 'radix error'
        var bufLen = this.data_.length << 5;
        var pos = bufLen;
        var buffer = new Array();
        for (var i = 0; i < bufLen; i ++) buffer.push(0);
        var tmp = this.clone();

        while (!tmp.isZero ())
            buffer[--pos] = this.CHARACTERS[tmp.divideInPlace(radix)];

        if (pos === bufLen)
            buffer[--pos] = '0';
        buffer = buffer.slice(pos, bufLen);
        return buffer.join('');
    };
    bigint.prototype.CHARACTERS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'];

    global.bigint = bigint;
}) (this);

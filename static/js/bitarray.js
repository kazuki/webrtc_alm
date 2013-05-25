(function(global) {
    var bitarray = function(capacity_bits) {
        var bytes = (capacity_bits >>> 3) + (capacity_bits % 8 == 0 ? 0 : 1);
        if (bytes % 2 === 1) bytes ++;
        this.raw_ = new ArrayBuffer(bytes);
        this.data_ = new Uint16Array(this.raw_);
        this.length = this.raw_.byteLength * 8;
    };
    bitarray.prototype.get = function(index) {
        var idx = Math.floor(index / 16);
        var pos = index % 16;
        if (idx < 0 || idx >= this.data_.length) throw 'out of range';
        return (this.data_[idx] & (1 << pos)) !== 0;
    };
    bitarray.prototype.set = function(index, val) {
        var idx = Math.floor(index / 16);
        var pos = index % 16;
        if (idx < 0 || idx >= this.data_.length) throw 'out of range';
        this.data_[idx] &= ~(1 << pos);
        if (val)
            this.data_[idx] |= 1 << pos;
    };
    bitarray.prototype.shiftLeft = function(shift) {
        var shift_idx = shift >>> 4;
        var shift_bits = shift % 16;
        for (var i = 0; i < this.data_.length - shift_idx; i ++)
            this.data_[this.data_.length - i - 1] = this.data_[this.data_.length - i - 1 - shift_idx];
        for (var i = 0; i < shift_idx; i ++)
            this.data_[i] = 0;
        if (shift_bits !== 0)
            throw 'not implemented';
    };
    bitarray.prototype.shiftRight = function(shift) {
        throw 'not implemented';
    };
    bitarray.prototype.toString = function() {
        var str = '';
        for (var i = this.length - 1; i >= 0; i --)
            str += this.get(i) ? '1' : '0';
        return str;
    };

    global.bitarray = bitarray;
}) (this);

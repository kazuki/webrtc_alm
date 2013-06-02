/* WebRTC DataChannel Firefox/Webkit Wrapper
 *
 *   interface wrapper {
 *     void addIceCandidate(iceCand);
 *     void createOffer(offerCallback);
 *     void createAnswer(offer, answerCallback);
 *     void acceptAnswer(answer);
 *
 *     void send(data);
 *     void close();
 *
 *     attribute event onopen;
 *     attribute event onicecandidate;
 *     attribute event onmessage;
 *     attribute event onerror;
 *     attribute event onclose;
 *   };
 *
 */
(function(global) {

    var data2str = function(data) {
        if (typeof data == 'string')
            return '0' + data;
        if (data.buffer) data = data.buffer.slice(data.byteOffset, data.byteLength);
        /*
        if (data.byteLength % 2 == 0)
            return '1' + String.fromCharCode.apply(null, new Uint16Array(data));
        var tmp = new ArrayBuffer(data.byteLength + 1);
        new Uint8Array(tmp).set(new Uint8Array(data));
        return '2' + String.fromCharCode.apply(null, new Uint16Array(tmp));
        */

        // 上記コメントアウトの方法では化けるのでデータ長は２倍になるが1文字1バイト割り当てで回避
        return '3' + String.fromCharCode.apply(null, new Uint8Array(data));
    };
    var str2data = function(str) {
        if (str.charAt(0) == '0')
            return str.substring(1);
        if (str.charAt(0) === '3') {
            var buf = new ArrayBuffer(str.length - 1);
            var view = new Uint8Array(buf);
            for (var i = 0; i < str.length - 1; i ++)
                view[i] = str.charCodeAt(i + 1) & 0xff;
            return buf;
        } else {
            var buf = new ArrayBuffer((str.length - 1) * 2);
            var bufView = new Uint16Array(buf);
            for (var i = 1, strLen = str.length; i < strLen; i++)
                bufView[i - 1] = str.charCodeAt(i);
            if (str.charAt(0) == '1')
                return buf;
            return buf.slice(0, buf.byteLength - 1);
        }
    };

    var mozPeerDataChannelWrapper = function() {
        var self = this;

        // attributes
        this.onopen = function() {};
        this.onicecandidate = function(iceCand) {};
        this.onmessage = function(ev) {};
        this.onerror = function(msg) {};
        this.onclose = function() {};
        this.total_recv_bytes = 0;
        this.total_recv_messages = 0;
        this.total_send_bytes = 0;
        this.total_send_messages = 0;

        // private variables
        this.ch_ = null;
        this.pc_ = new mozRTCPeerConnection();
        this.pc_.onicecandidate = function (ev) {
            if (ev.candidate)
                self.onicecandidate(ev.candidate);
        };
    };
    mozPeerDataChannelWrapper.prototype.send = function(data) {
        var str_data = data2str(data);
        this.ch_.send(str_data);
        this.total_send_bytes += str_data.length * 2;
        this.total_send_messages ++;
    };
    mozPeerDataChannelWrapper.prototype.close = function() {
        if (this.ch_) {
            try { this.ch_.close(); } catch (e) {}
            this.onclose();
            this.ch_ = null;
        }
        if (this.pc_) {
            try { this.pc_.close(); } catch (e) {}
            this.pc_ = null;
        }
    };
    mozPeerDataChannelWrapper.prototype.addIceCandidate = function(iceCand) {
        this.pc_.addIceCandidate(new mozRTCIceCandidate(iceCand));
    };
    mozPeerDataChannelWrapper.prototype.createOffer = function(offerCallback) {
        var self = this;
        navigator.mozGetUserMedia ({audio:true, fake:true}, function(as) {
            self.pc_.addStream(as);
            self.ch_ = self.pc_.createDataChannel("label", {});
            self.ch_.onopen = function() { self.onopen(); };
            self.ch_.onmessage = function(ev) {
                self.total_recv_bytes += ev.data.length * 2;
                self.total_recv_messages ++;
                self.onmessage(str2data(ev.data));
            };
            self.ch_.onclose = function() { self.close(); };
            self.pc_.createOffer(function (offer) {
                self.pc_.setLocalDescription(offer, function () {
                    offerCallback(offer);
                }, self.onerror);
            }, self.onerror);
        }, self.onerror);
    };
    mozPeerDataChannelWrapper.prototype.createAnswer = function(offer, answerCallback) {
        var self = this;
        navigator.mozGetUserMedia ({audio:true, fake:true}, function(as) {
            self.pc_.ondatachannel = function(ev) {
                self.ch_ = ev.channel;
                self.ch_.onopen = function() { self.onopen(); };
                self.ch_.onmessage = function(ev2) {
                    self.total_recv_bytes += ev2.data.length * 2;
                    self.total_recv_messages ++;
                    self.onmessage(str2data(ev2.data));
                };
                self.ch_.onclose = function() { self.close(); };
            };
            self.pc_.addStream(as);
            self.pc_.setRemoteDescription(new mozRTCSessionDescription(offer), function() {
                self.pc_.createAnswer(function(answer) {
                    self.pc_.setLocalDescription(answer, function() {
                        answerCallback(answer);
                    });
                }, self.onerror);
            }, self.onerror);
        }, self.onerror);
    };
    mozPeerDataChannelWrapper.prototype.acceptAnswer = function(answer) {
        var self = this;
        self.pc_.setRemoteDescription(new mozRTCSessionDescription(answer), function() {
        }, self.onerror);
    };

    var chromePeerDataChannelWrapper = function() {
        var self = this;

        // attributes
        this.onopen = function() {};
        this.onicecandidate = function(iceCand) {};
        this.onmessage = function(ev) {};
        this.onerror = function(msg) {};
        this.onclose = function() {};
        this.total_recv_bytes = 0;
        this.total_recv_messages = 0;
        this.total_send_bytes = 0;
        this.total_send_messages = 0;

        // private variables
        this.ch_ = null;
        this.pc_ = new webkitRTCPeerConnection(null, {optional: [{RtpDataChannels:true}]});
        this.pc_.onicecandidate = function (ev) {
            if (ev.candidate)
                self.onicecandidate(ev.candidate);
        };
    };
    chromePeerDataChannelWrapper.prototype.send = function(data) {
        var str_data = data2str(data);
        this.ch_.send(str_data);
        this.total_send_bytes += str_data.length * 2;
        this.total_send_messages ++;
    };
    chromePeerDataChannelWrapper.prototype.close = function() {
        if (this.ch_) {
            try { this.ch_.close(); } catch (e) {}
            if (this.onclose) this.onclose();
            this.ch_ = null;
        }
        if (this.pc_) {
            try { this.pc_.close(); } catch (e) {}
            this.pc_ = null;
        }
    };
    chromePeerDataChannelWrapper.prototype.addIceCandidate = function(iceCand) {
        this.pc_.addIceCandidate(new RTCIceCandidate(iceCand));
    };
    chromePeerDataChannelWrapper.prototype.createOffer = function(offerCallback) {
        var self = this;
        self.ch_ = self.pc_.createDataChannel("label", {reliable: false});
        self.ch_.onopen = function() { self.onopen(); };
        self.ch_.onmessage = function(ev) {
            self.total_recv_bytes += ev.data.length * 2;
            self.total_recv_messages ++;
            self.onmessage(str2data(ev.data));
        };
        self.ch_.onclose = function() { self.close(); };
        self.pc_.createOffer(function (offer) {
            self.pc_.setLocalDescription(offer, function () {
                offerCallback(offer);
            }, self.onerror);
        }, self.onerror);
    };
    chromePeerDataChannelWrapper.prototype.createAnswer = function(offer, answerCallback) {
        var self = this;
        self.pc_.ondatachannel = function(ev) {
            self.ch_ = ev.channel;
            self.ch_.onopen = function() { self.onopen(); };
            self.ch_.onmessage = function(ev2) {
                self.total_recv_bytes += ev2.data.length * 2;
                self.total_recv_messages ++;
                self.onmessage(str2data(ev2.data));
            };
            self.ch_.onclose = function() { self.close(); };
        };
        self.pc_.setRemoteDescription(new RTCSessionDescription(offer), function() {
            self.pc_.createAnswer(function(answer) {
                self.pc_.setLocalDescription(answer, function() {
                    answerCallback(answer);
                });
            }, self.onerror);
        }, self.onerror);
    };
    chromePeerDataChannelWrapper.prototype.acceptAnswer = function(answer) {
        var self = this;
        self.pc_.setRemoteDescription(new RTCSessionDescription(answer), function() {
        }, self.onerror);
    };
    
    global.createPeerConnectionWrapper = function() {
        try {
            return new mozPeerDataChannelWrapper();
        } catch (ex) {
            return new chromePeerDataChannelWrapper();
        }
    };

}) (this);

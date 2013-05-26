(function(global) {
    // simple implementation. (publish-subscribe type)
    var SimpleALM = function (ws_server_url) {
        // public properties & events
        this.maxDownStreams = 4;
        this.maxUpStreams = 2;
        this.groupName = "";
        this.groupDescription = "";
        this.keepAliveInterval = 10; // [sec]
        this.timeout = this.keepAliveInterval + 5;
        this.treeUpdateInterval = 10; // [sec]
        this.lastTreeUpdateTime = new Date();
        this.isGroupOwner = false;
        this.onmessage = function(msg) {};
        this.ontreeupdate = function(treemap) {};
        this.onstatechange = function(arg) {};

        // common
        this.ws_server_url_ = ws_server_url;
        this.downstreams_ = [];
        this.seqDummy_ = new ArrayBuffer(8);
        var seqDummyView = new Uint32Array(this.seqDummy_);
        seqDummyView[0] = 0; seqDummyView[1] = 0;
        this.pingReq_ = this.createPingMessage_(true);
        this.pingRes_ = this.createPingMessage_(false);
        this.replayWin = new bitarray(64);
        this.replayWinRight = new bigint (this.replayWin.length);

        // group owner
        this.ws_ = null;
        this.seqRaw_ = null;
        this.seq_ = null;
        this.treeMap_ = null; // {node_id: {date: recvDate, upstreams: [], downstreams: []}}

        // listener
        this.upstreams_ = [];
        this.id = null;
    };
    SimpleALM.prototype.createDownstreamInfo_ = function(owner, ws) {
        var info = new Object();
        info.owner = owner;
        info.connected = false;
        info.ws = ws;
        info.dataChannel = null;
        info.lastReceived = new Date();
        info.id = null;
        return info;
    };
    SimpleALM.prototype.createUpstreamInfo_ = function(owner, ws, key, other_id) {
        var info = new Object();
        info.owner = owner;
        info.connected = false;
        info.ws = ws;
        info.key = key;
        info.dataChannel = null;
        info.lastReceived = new Date();
        info.id = other_id;
        return info;
    };

    SimpleALM.prototype.create = function (groupName, groupDescription,
                                           successCallback, failureCallback) {
        this.upstreams_ = null;
        this.groupName = groupName;
        this.groupDescription = groupDescription;
        this.seqRaw_ = new ArrayBuffer(8);
        this.seq_ = new Uint32Array(this.seqRaw_);
        this.isGroupOwner = true;
        this.id = 0;
        this.treeMap_ = new Object();

        var self = this;
        this.ws_ = new WebSocket(this.ws_server_url_);
        this.ws_.owner_ = self;
        this.ws_.onopen = function(ev) {
            self.ws_.send(JSON.stringify({
                'm': 'create',
                'g': groupName,
                'd': groupDescription
            }));
        };
        this.ws_.onerror = function(ev) {
            failureCallback('disconnected server connection');
            self.leave();
        };
        this.ws_.onclose = this.ws_.onerror;
        this.ws_.onmessage = function(ev) {
            var res = JSON.parse(ev.data);
            if (res.r == 'ok') {
                self.ws_.onmessage = self.wsOnMessage_;
                successCallback();
            } else {
                failureCallback(res.r);
                self.leave();
            }
        };
    };
    SimpleALM.prototype.join = function (groupName,
                                         successCallback, failureCallback) {
        this.groupName = groupName;

        var self = this;
        self.joinSuccessCallback = successCallback;
        self.joinFailureCallback = failureCallback;
        
        var ws = new WebSocket(this.ws_server_url_);
        ws.owner_ = self;
        ws.handlers = new Object();
        ws.onopen = function(ev) {
            var msg = {
                'm': 'join',
                'g': groupName,
                'n': self.maxUpStreams
            };
            if (self.id) msg.i = self.id;
            ws.send(JSON.stringify(msg));
        };
        ws.onerror = function(ev) {
            failureCallback('disconnected server connection');
            self.leave();
        };
        ws.onclose = ws.onerror;
        ws.onmessage = function(ev) {
            var res = JSON.parse(ev.data);
            if (res.m == 'join') {
                if (res.r == 'ok') {
                    self.groupName = res.g;
                    self.groupDescription = res.d;
                    if (!self.id) {
                        self.id = res.i;
                    }
                } else {
                    try { ws.close(); } catch (ex) {}
                    failureCallback(res.r);
                    self.leave();
                }
            } else if (res.m == 'join_res') {
                self.addUpstream(self, ws, res.k, res.i);
            } else if ((res.m == 'answer' || res.m == 'ice') && ws.handlers[res.k]) {
                ws.handlers[res.k](res);
            } else {
                try { ws.close(); } catch (ex) {}
                failureCallback(res.r);
                self.leave();
            }
        };
    };
    SimpleALM.prototype.leave = function () {
        if (this.ws_) {
            this.ws_.onclose = this.ws_.onerror = null;
            try { this.ws_.close(); } catch (e) {}
            this.ws_ = null;
        }
    };
    SimpleALM.prototype.multicast = function (msg) {
        var self = this;
        var data = msg;
        var type = self.MSGTYPE_DATA;
        if (typeof msg == 'string') {
            data = self.str2bin_(msg);
            type = self.MSGTYPE_DATA_STR;
        }
        var multicastMsg = self.createMessage_(type, self.seqRaw_, data);
        self.incrementSeq_();
        self.multicast_(self, multicastMsg);
    };
    SimpleALM.prototype.multicast_ = function (self, msg) {
        self.downstreams_.forEach(function(strm, idx, array) {
            if (!strm.connected) return;
            strm.dataChannel.send(msg);
        });
    };
    SimpleALM.prototype.timer = function(self) {
        // keep-alive
        var nowTime = new Date().getTime();
        [self.downstreams_, self.upstreams_].forEach(function(streams, idx, parentArray) {
            if (!streams) return;
            streams.forEach(function(strm, idx, array) {
                var delta = (nowTime - strm.lastReceived.getTime()) / 1000;
                if (strm.connected && delta >= self.keepAliveInterval) {
                    if (delta > self.timeout) {
                        strm.dataChannel.close();
                    } else {
                        strm.dataChannel.send(self.pingReq_);
                    }
                }
            });
        });

        if (self.isGroupOwner && (nowTime - self.lastTreeUpdateTime.getTime()) / 1000 >= self.treeUpdateInterval) {
            var msg = self.createMessage_(self.MSGTYPE_GET_TREE_INFO, self.seqRaw_, new ArrayBuffer(0));
            self.incrementSeq_();
            self.multicast_(self, msg);
            self.lastTreeUpdateTime = new Date();
        }
    };

    SimpleALM.prototype.addDownstream = function(self, ephemeral_key) {
        var ws = new WebSocket(self.ws_server_url_);
        var info = self.createDownstreamInfo_(self, ws);
        self.downstreams_.push(info);
        self.invokeStateChange_(self, info.id, self.STATE_DOWNSTREAM, self.STATE_CONNECTING);
        ws.onopen = function(ev) {
            ws.send(JSON.stringify({
                'm': 'join_res',
                'i': self.id,
                'e': ephemeral_key
            }));
        };
        ws.onerror = function(ev) {
            self.closeDownstream(info);
        };
        ws.onclose = ws.onerror;
        ws.onmessage = function(ev) {
            var msg = JSON.parse(ev.data);
            if (msg.m == "offer") {
                info.id = msg.i;
                var conn = info.dataChannel = createPeerConnectionWrapper();
                conn.onerror = conn.onclose = function() {
                    self.closeDownstream(info);
                };
                conn.onopen = function() {
                    info.connected = true;
                    self.invokeStateChange_(self, info.id, self.STATE_DOWNSTREAM, self.STATE_CONNECTED);
                    ws.onerror = ws.onclose = null;
                    ws.close();
                };
                conn.onicecandidate = function(ev) {
                    ws.send(JSON.stringify({
                        'm': 'ice',
                        'd': JSON.stringify({
                            'candidate': ev.candidate,
                            'sdpMid': ev.sdpMid,
                            'sdpMLineIndex': ev.sdpMLineIndex
                        })
                    }));
                };
                conn.createAnswer(JSON.parse(msg.s), function (answer) {
                    ws.send(JSON.stringify({
                        'm': 'answer',
                        'i': self.id,
                        's': JSON.stringify(answer)
                    }));
                });
                conn.onmessage = function(msg) {
                    self.recvFromDownstream_(self, info, msg);
                };
            } else if (msg.m == 'ice') {
                info.dataChannel.addIceCandidate(JSON.parse(msg.d));
            } else {
                console.log("addDownStreamWS: received unknown. " + ev.data);
            }
        };
    };
    SimpleALM.prototype.addUpstream = function(self, ws, key, other_id) {
        if (self.upstreams_.length >= self.maxUpStreams) {
            // TODO: 上限を超えているので相手に対して切断要求を発行する
        }

        var info = self.createUpstreamInfo_(self, ws, key, other_id);
        self.upstreams_.push(info);
        var conn = info.dataChannel = createPeerConnectionWrapper();
        self.invokeStateChange_(self, info.id, self.STATE_UPSTREAM, self.STATE_CONNECTING);
        conn.onerror = conn.onclose = function() {
            self.closeUpstream(info);
        };
        conn.onopen = function() {
            info.connected = true;

            if (self.joinSuccessCallback) {
                self.joinSuccessCallback();
                self.joinSuccessCallback = null;
            }

            var connected_streams = 0;
            self.upstreams_.forEach(function(strm, idx, ary) {
                if (strm.connected)
                    connected_streams ++;
            });
            if (connected_streams >= self.maxUpStreams) {
                ws.onclose = ws.onerror = null;
                try { ws.close(); } catch (ex) {}
            }
            // TODO: タイムアウト等でwsをcloseする
            self.invokeStateChange_(self, info.id, self.STATE_UPSTREAM, self.STATE_CONNECTED);
        };
        conn.onmessage = function(msg) {
            self.recvFromUpstream_(self, info, msg);
        };
        conn.onicecandidate = function(ev) {
            ws.send(JSON.stringify({
                'm': 'ice',
                'k': key,
                'd': JSON.stringify({
                    'candidate': ev.candidate,
                    'sdpMid': ev.sdpMid,
                    'sdpMLineIndex': ev.sdpMLineIndex
                })
            }));
        };
        conn.createOffer(function (offer) {
            ws.send(JSON.stringify({
                'm': 'offer',
                'k': key,
                'i': self.id,
                's': JSON.stringify(offer)
            }));
        });
        ws.handlers[key] = function(msg) {
            if (msg.m == 'answer') {
                info.id = msg.i;
                conn.acceptAnswer(JSON.parse(msg.s));
            } else if (msg.m == 'ice') {
                conn.addIceCandidate(JSON.parse(msg.d));
            }
        };
    };
    SimpleALM.prototype.wsOnMessage_ = function(ev) {
        var msg = JSON.parse(ev.data);
        var self = this.owner_;
        if (msg.m == 'join') {
            self.handleJoinReq(self, msg, null);
        } else {
            console.log('Received Unknown Message from Server: ' + ev.data);
        }
    };
    SimpleALM.prototype.handleJoinReq = function(self, msg, seq) {
        if (self.downstreams_.length < self.maxDownStreams) {
            self.addDownstream(self, msg.e);
        } else {
            var n = msg.n;
            var active_streams = [];
            self.downstreams_.forEach(function(strm, idx, ary) {
                if (strm.connected)
                    active_streams.push(strm);
            });
            if (active_streams.length == 0)
                return;
            var x = (n <= active_streams.length ? 1 : n / active_streams.length);
            if (!seq) seq = self.seqRaw_;
            self.shuffleArray(active_streams);
            active_streams.forEach(function(strm, idx, ary) {
                if (n <= 0 || !strm.connected) return;
                msg.n = (idx < ary.length - 1 ? x : n);
                n -= msg.n;
                var binMsg = self.createMessage_(self.MSGTYPE_JOIN, seq,
                                                 self.str2bin_(JSON.stringify(msg)));
                strm.dataChannel.send(binMsg);
            });
            if (self.seqRaw_) self.incrementSeq_();
        }
    };
    SimpleALM.prototype.closeStream = function(streamArray, info) {
        var ret = false;
        for (var idx = 0; idx < streamArray.length; idx++) {
            if (streamArray[idx] == info) {
                streamArray.splice(idx, 1);
                ret = true;
                break;
            }
        }
        if (info.ws) {
            info.ws.onerror = info.ws.onclose = null;
            try { info.ws.close(); } catch (ex) {}
            info.ws = null;
        }
        if (info.dataChannel) {
            info.dataChannel.onerror = info.dataChannel.onclose = null;
            try { info.dataChannel.close(); } catch (ex) {}
            info.dataChannel = null;
        }
        return ret;
    };
    SimpleALM.prototype.closeUpstream = function(info) {
        var self = info.owner;
        if (self.closeStream(self.upstreams_, info))
            self.invokeStateChange_(self, info.id, self.STATE_UPSTREAM, info.connected ? self.STATE_CLOSED : self.STATE_FAILED);
    };
    SimpleALM.prototype.closeDownstream = function(info) {
        var self = info.owner;
        if (self.closeStream(self.downstreams_, info))
            self.invokeStateChange_(self, info.id, self.STATE_DOWNSTREAM, info.connected ? self.STATE_CLOSED : self.STATE_FAILED);
    };
    SimpleALM.prototype.recvFromUpstream_ = function(self, conn, data) {
        conn.lastReceived = new Date();
        if (!self.checkReplay_(self, data.slice(1, 9)))
            return; // replay
        var view = new Uint8Array(data);
        if (self.isCtrlMsgType_(view[0])) {
            self.handleCtrlMsg_(self, conn, data);
        } else {
            self.downstreams_.forEach(function(strm, idx, array) {
                if (!strm.connected) return;
                strm.dataChannel.send(data);
            });
            var msg = data.slice(9);
            if (view[0] == self.MSGTYPE_DATA_STR)
                msg = self.bin2str_(msg);
            if (self.onmessage)
                self.onmessage(msg);
        }
    };
    SimpleALM.prototype.recvFromDownstream_ = function(self, conn, data) {
        conn.lastReceived = new Date();
        var view = new Uint8Array(data);
        if (view[0] != self.MSGTYPE_DATA) {
            self.handleCtrlMsg_(self, conn, data);
        } else {
            console.log("recv from downstream: " + data);
        }
    };
    SimpleALM.prototype.handleCtrlMsg_ = function(self, conn, data) {
        var view = new Uint8Array(data);
        if (view[0] == self.MSGTYPE_PING) {
            if (view[9] == 0)
                conn.dataChannel.send(self.pingRes_);
        } else if (view[0] == self.MSGTYPE_JOIN) {
            self.handleJoinReq(self, JSON.parse(self.bin2str_(data.slice(9))), data.slice(1, 9));
        } else if (view[0] == self.MSGTYPE_GET_TREE_INFO) {
            self.multicast_(self, data);
            var body = new ArrayBuffer(4 * 3 + 4 * (self.upstreams_.length + self.downstreams_.length));
            var view = new Uint32Array(body);
            view[0] = self.id;
            view[1] = self.upstreams_.length;
            view[2] = self.downstreams_.length;
            var i = 3;
            self.upstreams_.concat(self.downstreams_).forEach (function(strm, idx, array) {
                if (strm.connected) {
                    view[i] = strm.id;
                    i += 1;
                }
            });
            var msg = self.createMessage_(self.MSGTYPE_NOTIFY_TREE_INFO, self.seqDummy_, body.slice(0, 4 * i));
            self.upstreams_[0].dataChannel.send(msg);
        } else if (view[0] == self.MSGTYPE_NOTIFY_TREE_INFO) {
            if (self.isGroupOwner) {
                var view = new Uint32Array(data.slice(9));
                var entry = new Object();
                entry.date = new Date();
                entry.id = view[0];
                entry.upstreams = [];
                entry.downstreams = [];
                for (var i = 3; i < 3 + view[1]; i++)
                    entry.upstreams.push(view[i]);
                for (var i = 3 + view[1]; i < 3 + view[1] + view[2]; i++)
                    entry.downstreams.push(view[i]);
                self.treeMap_[view[0] + ""] = entry;
                if (self.ontreeupdate) {
                    self.ontreeupdate(self.treeMap_);
                }
            } else if (self.upstreams_.length > 0) {
                self.upstreams_[0].dataChannel.send(data);
            }
        } else {
            console.log("recv not handled ctrl-msg: " + view[0] + ", size=" + data.byteLength);
            console.log(view);
        }
    };

    SimpleALM.prototype.str2bin_ = function(str) {
        var buf = new ArrayBuffer(str.length * 2);
        var bufView = new Uint16Array(buf);
        for (var i = 0, strLen = str.length; i < strLen; i++)
            bufView[i] = str.charCodeAt(i);
        return buf;
    };
    SimpleALM.prototype.bin2str_ = function(data) {
        return String.fromCharCode.apply(null, new Uint16Array(data));
    };
    SimpleALM.prototype.createMessage_ = function(type, seq, data) {
        if (typeof data == 'string')
            data = str2bin_(data);
        var msg = new ArrayBuffer(1 + 8 + data.byteLength);
        var view = new Uint8Array(msg);
        view[0] = type;
        view.set(new Uint8Array(seq), 1);
        view.set(new Uint8Array(data), 9);
        return msg;
    };
    SimpleALM.prototype.incrementSeq_ = function() {
        this.seq_[0] = this.seq_[0] + 1;
        if (this.seq_[0] == 0)
            this.seq_[1] = this.seq_[1] + 1;
    };
    SimpleALM.prototype.MSGTYPE_PING = 1;
    SimpleALM.prototype.MSGTYPE_JOIN = 2;
    SimpleALM.prototype.MSGTYPE_GET_TREE_INFO = 3;
    SimpleALM.prototype.MSGTYPE_NOTIFY_TREE_INFO = 4;
    SimpleALM.prototype.MSGTYPE_DATA = 254;
    SimpleALM.prototype.MSGTYPE_DATA_STR = 255;
    SimpleALM.prototype.isCtrlMsgType_ = function(type) {
        return type < 0x80;
    };
    SimpleALM.prototype.createPingMessage_ = function(is_req) {
        var body = new ArrayBuffer(1);
        var view = new Uint8Array(body);
        view[0] = (is_req ? 0 : 1);
        return this.createMessage_(this.MSGTYPE_PING, this.seqDummy_, body);
    };
    SimpleALM.prototype.shuffleArray = function(array) {
        var i = array.length;
        while(i){
            var j = Math.floor(Math.random()*i);
            var t = array[--i];
            array[i] = array[j];
            array[j] = t;
        }
        return array;
    };
    SimpleALM.prototype.checkReplay_ = function(self, seq) {
        seq = new bigint(seq);
        if (seq.isZero()) return true;
        var delta = null;
        do {
            if (self.replayWinRight.compareTo(seq) < 0)
                break;
            delta = self.replayWinRight.clone();
            delta.subtractInPlace(seq);
            if (delta.bitcount() > self.replayWin.length)
                return false;
            if (self.replayWin.get(delta.toInt()))
                return false;
        } while (false);

        if (delta == null) {
            var shift_size = 16;
            var newRight = null;
            do {
                newRight = self.replayWinRight.add(new bigint(shift_size));
                if (newRight.compareTo(seq) > 0)
                    break;
                shift_size += 16;
            } while (true);
            self.replayWinRight = newRight;
            self.replayWin.shiftLeft(shift_size);
            delta = self.replayWinRight.clone();
            delta.subtractInPlace(seq);
        }

        self.replayWin.set(delta, true);
        return true;
    };
    SimpleALM.prototype.invokeStateChange_ = function(self, id, direction, state) {
        if (!self.onstatechange) return;
        if (id == null) id = null;
        self.onstatechange({
            'id': id,
            'direction': direction,
            'state': state
        });
    };
    SimpleALM.prototype.STATE_UPSTREAM   = 'up';
    SimpleALM.prototype.STATE_DOWNSTREAM = 'down';
    SimpleALM.prototype.STATE_CONNECTING = 'connecting';
    SimpleALM.prototype.STATE_CONNECTED  = 'connected';
    SimpleALM.prototype.STATE_FAILED     = 'failed';
    SimpleALM.prototype.STATE_CLOSED     = 'closed';

    global.WebRTCALM = {
        create: function(type, ws_server_url) {
            return new SimpleALM(ws_server_url);
        }
    };
}) (this);

var EndPoint_Create = "/alm_create";
var EndPoint_Join = "/alm_join";
var EndPoint_Cand = "/alm_cand";

var WebRTC_PeerConnection_Servers = null;
var WebRTC_PeerConnection_Argument = {optional: [{RtpDataChannels:true}]};
var WebRTC_DataChannel_Options = {reliable: false};

var WebRTC_ALM = function(host) {
    this.ws_ = null;
    this.join_ = false;
    this.server_ = 'ws://' + host;
    this.broadcaster_ = false;
    this.upstreams = [];
    this.downstreams = [];
    this.max_upstreams = 1;  // TODO
    this.max_downstreams = 1;
    this.handler = null;
};
var WebRTC_ALM_DataChannelInfo = function(alm) {
    this.alm = alm;
    this.connected = false;
    this.wsock = null;
    this.ekey = null;
    this.conn = null; // peerconnection
    this.ch = null;   // datachannel
};

WebRTC_ALM.prototype.multicast = function(data) {
    for(var i = 0; i < this.downstreams.length; ++i) {
        this.downstreams[i].ch.send(data);
    }
};

WebRTC_ALM.prototype.create_group = function (group_id, ok_callback, err_callback) {
    var owner = this;
    if (this.join_) throw 'already created/joined group';
    this.ws_ = new WebSocket(this.server_ + EndPoint_Create);
    this.ws_.onopen = function(ev) {
        owner.ws_.send(JSON.stringify({'g': group_id}));
    };
    this.ws_.onmessage = function(ev) {
        console.log('[create group] recv msg: ' + ev.data);
        msg = JSON.parse(ev.data);
        if (msg.r == 'ok') {
            owner.ws_.self = owner;
            owner.ws_.onmessage = owner._groupRootRecvMsg;
            ok_callback();
        } else {
            owner._close();
            err_callback();
        }
    };
};
  
WebRTC_ALM.prototype.join_group = function (group_id, ok_callback, err_callback, msg_callback) {
    var owner = this;
    if (this.join_) throw 'already created/joined group';
    this.handler = msg_callback;

    owner.ws_ = new WebSocket(owner.server_ + EndPoint_Join);
    owner.ws_.onopen = function(ev) {
        var upstrm = new WebRTC_ALM_DataChannelInfo(this);
        upstrm.conn = new webkitRTCPeerConnection(
            WebRTC_PeerConnection_Servers, WebRTC_PeerConnection_Argument
        );
        upstrm.conn.onicecandidate = function(ev) {
            if (ev.candidate) {
                console.log('[join group] onicecandidate');
                owner.ws_.send(JSON.stringify({'ice':JSON.stringify(ev.candidate)}));
            }
        };
        upstrm.ch = upstrm.conn.createDataChannel(group_id, WebRTC_DataChannel_Options);
        upstrm.ch.onopen = function() {
            console.log("DataChannel: onOpen");
            ok_callback();
        };
        upstrm.ch.alm = owner;
        upstrm.ch.onmessage = owner.ReceiveMessageFromUpstream;
        owner.upstreams.push(upstrm);

        upstrm.conn.createOffer(function(offer) {
            console.log(offer);
            upstrm.conn.setLocalDescription(offer);
            owner.ws_.send(JSON.stringify({'g': group_id, 's': JSON.stringify(offer)}));
            owner.ws_.onmessage = function(ev) {
                console.log('[join group] recv msg: ' + ev.data);
                msg = JSON.parse(ev.data);
                if (msg.r && msg.r == 'ok') {
                    answer_desc = new RTCSessionDescription({type:'answer', sdp:JSON.parse(msg.s).sdp});
                    upstrm.conn.setRemoteDescription(answer_desc);
                } else if (msg.ice) {
                    console.log('[join group] added ice');
                    upstrm.conn.addIceCandidate(new RTCIceCandidate(JSON.parse(msg.ice)));
                } else {
                    owner._close();
                    err_callback();
                }
            };
        });
    };
};
WebRTC_ALM.prototype._groupRootRecvMsg = function(ev) {
    console.log('[group root] recv msg: ' + ev.data);
    var msg = JSON.parse(ev.data);
    if (msg.m == 'new') {
        this.self._receivedNewMemberMsg(msg.e, msg.s);
    }
}
WebRTC_ALM.prototype._receivedNewMemberMsg = function(ekey, offer_sdp) {
    console.log('[recv new-member] ephemeral_key=' + ekey);
    if (this.downstreams.length < this.max_downstreams) {
        var info = new WebRTC_ALM_DataChannelInfo(this);
        info.ekey = ekey;
        info.start_candidate_process(offer_sdp);
    } else {
        var msg = JSON.stringify({'m':'new','e':ekey,'s':offer_sdp});
        //msg = new Zlib.Deflate(msg).compress();
        msg = RawDeflate.deflate(msg);
        console.log('compressed_msg_size=' + msg.length);
        for(var i = 0; i < this.downstreams.length; ++i) {
            this.downstreams[i].ch.send(msg);
        }
        console.log('[recv new-member] relayed ' + this.downstreams.length + ' peers');
    }
};
WebRTC_ALM.prototype._close = function(ev) {
    if (this.ws_ != null) {
        this.ws_.close();
        this.ws_ = null;
    }
    this.join_ = false;
    this.broadcaster_ = false;
};

WebRTC_ALM.prototype.is_broadcaster = function() { return this.broadcaster_; };

WebRTC_ALM_DataChannelInfo.prototype.start_candidate_process = function(offer_sdp) {
    console.log('[cand] start');
    var info = this;
    info.wsock = new WebSocket(this.alm.server_ + EndPoint_Cand);
    info.wsock.owner = this;
    info.wsock.onopen = function(ev) {
        info.conn = new webkitRTCPeerConnection(
            WebRTC_PeerConnection_Servers, WebRTC_PeerConnection_Argument
        );
        info.conn.onicecandidate = function(ev) {
            if (ev.candidate) {
                console.log('[owner] onicecandidate');
                info.wsock.send(JSON.stringify({'ice':JSON.stringify(ev.candidate)}));
            }
        };
        info.conn.ondatachannel = function(ev) {
            info.ch = ev.channel;
            info.ch.onopen = function() {
                console.log("DataChannel: onOpen (passive)");
            };
            console.log("onDataChannel Callback");
        };
        info.wsock.onmessage = function(ev) {
            var msg = JSON.parse(ev.data);
            if (msg.ice) {
                console.log('[owner] added ice');
                info.conn.addIceCandidate(new RTCIceCandidate(JSON.parse(msg.ice)));
            }
        };
        info.alm.downstreams.push(info);

        console.log(JSON.parse(offer_sdp));
        offer_desc = new RTCSessionDescription({type:'offer', sdp:JSON.parse(offer_sdp).sdp});
        info.conn.setRemoteDescription(offer_desc);
        info.conn.createAnswer(function(answer_sdp) {
            console.log('created answer: ' + answer_sdp);
            info.conn.setLocalDescription(answer_sdp);
            info.wsock.send(JSON.stringify({'e':info.ekey,'s':JSON.stringify(answer_sdp)}));
        });
    };

};

WebRTC_ALM.prototype.ReceiveMessageFromUpstream = function(ev) {
    console.log('[listener] recv msg from upstream');

    var msg = {'m':'binary-blob'};
    var is_ctrl = false;
    try {
        //msg = JSON.parse(new Zlib.Inflate(ev.data).decompress());
        msg = JSON.parse(RawDeflate.inflate(ev.data));
        if (msg.m && (msg.m == 'new'))
            is_ctrl = true;
    } catch (ex) {}

    if (msg.m == 'new' && this.alm.downstreams.length < this.alm.max_downstreams) {
        console.log('[listener] recv new-member req from upstream');
        var info = new WebRTC_ALM_DataChannelInfo(this.alm);
        info.ekey = msg.e;
        info.start_candidate_process(msg.s);
    } else {
        console.log('[listener] relay message-type=' + msg.m);
        if (!is_ctrl)
            this.alm.handler(ev.data);
        for(var i = 0; i < this.alm.downstreams.length; ++i) {
            this.alm.downstreams[i].ch.send(ev.data);
        }
    }
};

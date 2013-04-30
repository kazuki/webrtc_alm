$(function(){
    var client1 = new WebRTC_ALM(window.location.host);
    var client2 = new WebRTC_ALM(window.location.host);

    var output_viewer = function(txt) {
        $("#txt_viewer").val(txt + "\r\n" + $("#txt_viewer").val());
    };

    $("#btn_create_group").click(function(){
        client1.create_group('test', function() {
            $("#post_area").css('display', 'block');
        }, function(reason) {
            alert('create: err. reason=' + reason);
        });
    });
    $("#btn_post").click(function(){
        var data = $("#txt_post").val();
        client1.multicast(data);
    });

    $("#btn_join_group").click(function(){
        client2.join_group('test', function() {
            $("#view_area").css('display', 'block');
        }, function(reason) {
            alert('join: err. reason=' + reason);
        }, function(data) {
            output_viewer(data);
        });
    });



    /* RTCPeerConnection動作確認用 */
    $("#btn_test").click(function() {
        var servers = null;
        var ctor = {optional: [{RtpDataChannels:true}]};

        var pc1 = new webkitRTCPeerConnection(servers, ctor);
        var pc2 = new webkitRTCPeerConnection(servers, ctor);
        pc1.onicecandidate = function(ev) {
            console.log("pc1: onicecandidate: " + ev);
            if (ev.candidate) {
                pc2.addIceCandidate(ev.candidate);
            }
        };
        pc2.onicecandidate = function(ev) {
            console.log("pc2: onicecandidate: " + ev);
            if (ev.candidate) {
                pc1.addIceCandidate(ev.candidate);
            }
        };
        console.log('created RTCPeerConnection');

        var ch1 = pc1.createDataChannel("test", {reliable:false});
        ch1.onopen = function() { console.log("channel1: onOpen"); };
        ch1.onclose = function() { console.log("channel1: onClose"); };
        var ch2 = null;
        console.log("created channel2");

        pc1.createOffer(function(offer) {
            pc1.setLocalDescription(offer);
            console.log("pc1 offer:" + offer);
            pc2.setRemoteDescription(offer);
            pc2.createAnswer(function(answer) {
                console.log("pc2 answer:" + offer);
                pc2.setLocalDescription(answer);
                pc1.setRemoteDescription(answer);
            });
        });
        pc2.ondatachannel = function(ev) {
            ch2 = ev.channel;
            ch2.onopen = function() { console.log("channel2: onOpen"); };
            ch2.onclose = function() { console.log("channel2: onClose"); };
            console.log("created channel2");
        };
    });
});

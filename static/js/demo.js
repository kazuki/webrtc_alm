$(function() {
    var ws_server_url_ = (window.location.protocol === 'http:' ? 'ws://' : 'wss://')
        + window.location.host
        + window.location.pathname.substr(0, window.location.pathname.lastIndexOf('/'))
        + '/ws';
    var alm_ = null;

    var setupALMOptions = function(alm) {
        var getValidatedIntValue = function(id, min, max) {
            var tmp = $(id).val();
            if (tmp && tmp >= min && tmp <= max)
                return parseInt(tmp);
            return parseInt($(id).attr("placeholder"));
        };
        alm.maxUpStreams = getValidatedIntValue("#maxUpstreams", 1, 8);
        alm.maxDownStreams = getValidatedIntValue("#maxDownstreams", 1, 8);
        var update_connstat = function() {
            var info = alm.getConnectionInfo();
            var str = '';
            if (info.up.length > 0) {
                str = "upstreams (" + info.up.length + "/" + alm.maxUpStreams + "):";
                info.up.forEach(function(x,idx,ary) {
                    str += "\n    id=" + x.id + ": " + (x.connected ? "connected" : "connecting");
                    if (x.connected)
                        str += ' (recv:' + x.recv_bytes + '[b]/' + x.recv_msg + '[msg], send:' + x.send_bytes + '[b]/' + x.send_msg + '[msg]';
                });
            }
            if (info.down.length > 0) {
                if (str.length > 0) str += "\n";
                str += "downstreams (" + info.down.length + "/" + alm.maxDownStreams + "):";
                info.down.forEach(function(x,idx,ary) {
                    str += "\n    id=" + x.id + ": " + (x.connected ? "connected" : "connecting");
                    if (x.connected)
                        str += ' (recv:' + x.recv_bytes + '[b]/' + x.recv_msg + '[msg], send:' + x.send_bytes + '[b]/' + x.send_msg + '[msg]';
                });
            }
            $("div.conninfo").text(str);
        }
        alm.onstatechange = function(arg) {
            console.log(arg.id + ": " + arg.state + " (" + arg.direction + ")");
            update_connstat();
        };

        window.setInterval(function() {
            alm.timer(alm);
            update_connstat();
        }, 1000);
    };
    var errorUI = function(msg) {
        $("#initPane").css("display", "none");
        $("#errPane").css("display", "block");
        $("#groupOwnerPane").css("display", "none");
        $("#errMsg").text(msg);
    };
    var resetUI = function() {
        $("#initPane").css("display", "block");
        $("#errPane").css("display", "none");
        if (alm_) {
            try {
                alm_.leave();
            } catch (e) {}
            alm_ = null;
        }
    };

    $("#createALM").click(function() {
        var groupName = $("#createGroupName").val();
        var groupDesc = $("#createGroupDesc").val();
        if (!groupName || groupName.length == 0) {
            alert("invalid GroupName");
            return;
        }
        alm_ = WebRTCALM.create('simple', ws_server_url_);
        setupALMOptions(alm_);
        alm_.create(groupName, groupDesc, function() {
            $("#initPane").css("display", "none");
            $("#groupOwnerPane").css("display", "block");
            $("#groupInfoName").text(groupName);
            $("#groupInfoDescription").text(groupDesc);
        }, function(reason) {
            errorUI(reason);
        });
        alm_.ontreeupdate = function(map) {
            var graph = [];
            for (var key in map) {
                var entry = map[key];
                var list = [];
                for (var i = 0; i < entry.upstreams.length; i ++)
                    list.push(entry.upstreams[i] + "");
                graph.push({
                    "id": entry.id + "",
                    "name": entry.id + "",
                    "adjacencies": list
                });
            }
            graph.unshift({"id":"0","name":"root","adjacencies":[]});
            drawTreeGraph(graph);
            console.log(JSON.stringify(graph));
        };
    });

    $("#joinALM").click(function() {
        var groupName = $("#joinGroupName").val();
        if (!groupName || groupName.length == 0) {
            alert("invalid GroupName");
            return;
        }
        alm_ = WebRTCALM.create('simple', ws_server_url_);
        setupALMOptions(alm_);
        alm_.join(groupName, function() {
            $("#initPane").css("display", "none");
            $("#listenerPane").css("display", "block");
            $("#groupInfoName2").text(alm_.groupName);
            $("#groupInfoDescription2").text(alm_.groupDescription);
        }, function(reason) {
            errorUI(reason);
        });
        alm_.onmessage = function(msg) {
            var line = $(document.createElement("div"));
            line.append(document.createTextNode(msg));
            $("#recvMsg").prepend(line);
        };
    });

    $("#resetButton").click(function() {
        resetUI();
    });

    $("#multicast").click(function() {
        alm_.multicast($("#multicastText").val());
    });

    var rgraph = null;
    function drawTreeGraph(json) {
        if (!rgraph) {
            rgraph = new $jit.RGraph({
                injectInto: 'treeGraph',
                background: {
                    CanvasStyles: {
                        strokeStyle: '#555'
                    }
                },
                Navigation: {
                    enable: true,
                    panning: true,
                    zooming: 10
                },
                Node: {
                    color: '#000'
                },
                Edge: {
                    color: '#888',
                    lineWidth:1.5
                },
                onCreateLabel: function(domElement, node){
                    domElement.innerHTML = node.name;
                },
                onPlaceLabel: function(domElement, node){
                    var style = domElement.style;
                    style.display = '';
                    style.fontSize = "1ex";
                    style.color = "#000";
                    var left = parseInt(style.left);
                    var w = domElement.offsetWidth;
                    style.left = (left - w / 2) + 'px';
                }
            });
        }
            
        rgraph.loadJSON(json);
        rgraph.refresh();
    }
});

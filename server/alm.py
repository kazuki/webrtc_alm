import time, datetime, json
import tornado.web
import tornado.websocket

class SharedState:
    def __init__(self):
        self.groups = {}
        self.group_id_gen = 0
        self.sockMap = {}
        self.join_key = 1
        self.join_requests = {}
class GroupInfo:
    def __init__(self, owner, group_id, name, desc):
        self.owner = owner
        self.group_id = group_id
        self.name = name
        self.description = desc
        self.node_id = 1

inproc_state = SharedState()

class SimpleALMWebSocket(tornado.websocket.WebSocketHandler):
    def open(self):
        self.groupInfo = None
        self.joinKey = None
        self.relayTarget = None
        self.relayKey = None
        self.relayTargets = None
        print("WebSocket opened")
    def on_message(self, message):
        msg = json.loads(message);
        response = {'r':'unknown method'}
        if 'm' in msg:
            response['m'] = msg['m']
            if msg['m'] == 'create':
                if 'g' in msg:
                    groupInfo = GroupInfo(self, inproc_state.group_id_gen, msg['g'], msg.get('d',''))
                    inproc_state.group_id_gen += 1
                    self.groupInfo = groupInfo
                    inproc_state.groups[groupInfo.group_id] = groupInfo
                    inproc_state.sockMap[self] = groupInfo
                    response['g'] = groupInfo.group_id
                    response['n'] = groupInfo.name
                    response['d'] = groupInfo.description
                    response['r'] = 'ok'
                else:
                    response['r'] = 'invalid argument:"g"'
            elif msg['m'] == 'join':
                if msg.get('g','') in inproc_state.groups:
                    groupInfo = inproc_state.groups[msg['g']]
                    self.groupInfo = groupInfo
                    self.joinKey = inproc_state.join_key
                    self.relayTargets = []
                    if 'i' in msg:
                        self.node_id = msg['i']
                    else:
                        self.node_id = groupInfo.node_id
                        groupInfo.node_id += 1
                        msg['i'] = self.node_id
                    inproc_state.join_key += 1
                    msg['e'] = self.joinKey
                    inproc_state.join_requests[self.joinKey] = self
                    groupInfo.owner.write_message(json.dumps(msg))
                    response['r'] = 'ok'
                    response['g'] = groupInfo.group_id
                    response['n'] = groupInfo.name
                    response['d'] = groupInfo.description
                    response['i'] = self.node_id
                else:
                    response['r'] = 'unknown group id "' + msg.get('g','') + '"'
            elif msg['m'] == 'join_res':
                if msg.get('e',0) in inproc_state.join_requests:
                    self.relayTarget = inproc_state.join_requests[msg['e']]
                    self.relayKey = len(self.relayTarget.relayTargets)
                    self.relayTarget.relayTargets.append(self)
                    self.relayTarget.write_message(json.dumps({
                        'm': 'join_res',
                        'i': msg['i'],
                        'k': self.relayKey
                    }));
                    print("reserved ephemeral=" + str(msg['e']) + ", key=" + str(self.relayKey))
                    return
                else:
                    response['r'] = 'unknown ephemeral-key'
            elif 'k' in msg and (msg['m'] == 'offer' or msg['m'] == 'ice'):
                if self.relayTargets and msg['k'] < len(self.relayTargets) and self.relayTargets[msg['k']]:
                    tmp_key = msg['k']
                    del msg['k']
                    self.relayTargets[tmp_key].write_message(json.dumps(msg))
                    print(">> relay " + msg['m'] + ". ephemeral=" + str(self.joinKey)  + ", key=" + str(tmp_key))
                    return
                else:
                    print("NOT IMPLEMENTED #1")
            elif 'k' not in msg and (msg['m'] == 'answer' or msg['m'] == 'ice'):
                if self.relayTarget:
                    msg['k'] = self.relayTarget.relayTargets.index(self)
                    self.relayTarget.write_message(json.dumps(msg))
                    print("<< relay " + msg['m'] + ". ephemeral=" + str(self.relayTarget.joinKey)  + ", key=" + str(msg['k']))
                    return
                else:
                    print("NOT IMPLEMENTED #2")
                    
        print("Request: " + str(msg) + "\r\n"
             +"    Res: " + str(response))
        self.write_message(json.dumps(response));

    def on_close(self):
        if self in inproc_state.sockMap:
            groupInfo = inproc_state.sockMap[self]
            print("GroupOwner WebSocket closed")
            del inproc_state.sockMap[self]
            del inproc_state.groups[groupInfo.group_id]

class SimpleALMAPI(tornado.web.RequestHandler):
    def get(self, method):
        if method == 'list':
            self.get_list()
    def get_list(self):
        self.set_header('content-type', 'application/json')
        self.write(json.dumps([{
            'g': v.group_id,
            'n': v.name,
            'd': v.description
        } for k, v in inproc_state.groups.items()]))

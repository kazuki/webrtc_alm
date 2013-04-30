using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Text;
using Codeplex.Data;
using Kazuki.Net.HttpServer;

namespace BootstrappingServer
{
    public class WebRTCALMTestApp : IHttpApplication
    {
        long ephemeral_ = 0;
        Dictionary<string, ALMInfo> groups_ = new Dictionary<string, ALMInfo> ();
        Dictionary<long, JoinInfo> waitings_ = new Dictionary<long, JoinInfo>();
        static Encoding JSONEncoding = Encoding.UTF8;

        public WebRTCALMTestApp ()
        {
            StaticFileDirectory = "static";
        }

        public object Process (IHttpServer server, IHttpRequest req, HttpResponseHeader res)
        {
            switch (req.Url.AbsolutePath) {
            case "/alm_create":
                return ProcessCreateGroup(server, req, res);
            case "/alm_join":
                return ProcessJoinGroup(server, req, res);
            case "/alm_cand":
                return ProcessCandidatePeer(server, req, res);
            }
            return ProcessStaticFile (server, req, res);
        }

        object ProcessCreateGroup (IHttpServer server, IHttpRequest req, HttpResponseHeader res)
        {
            WebSocketInfo wi = new WebSocketInfo (req, res, GroupOwnerWebSocketHandler, new ALMInfo());
            return wi;
        }
        void GroupOwnerWebSocketHandler (object sender, WebSocketEventArgs args)
        {
            WebSocketInfo wi = args.Info;
            ALMInfo info = (ALMInfo)wi.State;
            var msg = DynamicJson.Parse(JSONEncoding.GetString(args.Payload, 0, (int)args.PayloadSize));
            if (info.State == ALMGroupState.Initialized) {
                info.GroupID = msg.g;
                info.GroupName = msg.IsDefined("n") ? msg.n : info.GroupID;
                info.GroupDescription = msg.IsDefined("d") ? msg.d : string.Empty;
                dynamic retMsg = new DynamicJson();
                lock (groups_) {
                    if (groups_.ContainsKey(info.GroupID)) {
                        info.State = ALMGroupState.Error;
                        retMsg.r = "group_id already exists";
                    } else {
                        groups_.Add (info.GroupID, info);
                        info.State = ALMGroupState.Created;
                        retMsg.r = "ok";
                        info.Info = wi;
                    }
                }
                wi.Send (retMsg.ToString(), JSONEncoding);
                return;
            }
            if (info.State == ALMGroupState.Created) {
            }
        }

        object ProcessJoinGroup (IHttpServer server, IHttpRequest req, HttpResponseHeader res)
        {
            WebSocketInfo wi = new WebSocketInfo (req, res, JoinWebSocketHandler, new JoinInfo());
            return wi;
        }
        void JoinWebSocketHandler (object sender, WebSocketEventArgs args)
        {
            WebSocketInfo wi = args.Info;
            JoinInfo info = (JoinInfo)wi.State;
            var msg = DynamicJson.Parse(JSONEncoding.GetString(args.Payload, 0, (int)args.PayloadSize));
            if (info.State == JoinState.Initialized) {
                Console.WriteLine("[JoinHandler] Initialized");
                ALMInfo group = null;
                lock (groups_) {
                    if (!groups_.TryGetValue(msg.g, out group)) group = null;
                }
                if (group == null) {
                    dynamic retMsg = new DynamicJson();
                    retMsg.r = "not found";
                    Console.WriteLine("[JoinHandler] NotFound group");
                    wi.Send (retMsg.ToString(), JSONEncoding);
                } else {
                    info.RequestedPeer = wi;
                    dynamic newMemberMsg = new DynamicJson();
                    long ekey = Interlocked.Increment (ref ephemeral_);
                    newMemberMsg.m = "new";
                    newMemberMsg.e = ekey.ToString();
                    newMemberMsg.s = msg.s;
                    lock (waitings_) {
                        waitings_.Add (ekey, info);
                    }
                    info.State = JoinState.IceProcess;
                    Console.WriteLine("[JoinHandler] Relay Offer SDP");
                    group.Info.Send (newMemberMsg.ToString(), JSONEncoding);
                }
                return;
            }
            if (info.State == JoinState.IceProcess) {
                if (info.CandidatePeer == null) {
                    lock (info.IceQueue) {
                        info.IceQueue.Add(msg.ice);
                    }
                    Console.WriteLine("[JoinHandler] Ice Candidates added to queue");
                } else {
                    dynamic msg2 = new DynamicJson();
                    msg2.ice = msg.ice;
                    Console.WriteLine("[JoinHandler] Relay Ice Candidates");
                    string json = msg2.ToString();
                    info.CandidatePeer.Send(json, JSONEncoding);
                }
                return;
            }
        }

        object ProcessCandidatePeer (IHttpServer server, IHttpRequest req, HttpResponseHeader res)
        {
            WebSocketInfo wi = new WebSocketInfo (req, res, CandidateWebSocketHandler, new CandidateInfo());
            return wi;
        }
        void CandidateWebSocketHandler (object sender, WebSocketEventArgs args)
        {
            WebSocketInfo wi = args.Info;
            CandidateInfo info = (CandidateInfo)wi.State;
            var msg = DynamicJson.Parse (JSONEncoding.GetString (args.Payload, 0, (int)args.PayloadSize));
            string errMsg = string.Empty;
            if (info.State == CandidateState.Initialized) {
                Console.WriteLine ("[CandidateHandler] Initialized");
                long key;
                if (!msg.IsDefined ("e") || !msg.IsDefined ("s") || !long.TryParse (msg.e, out key)) {
                    errMsg = "msg format error";
                    goto OnError;
                }
                JoinInfo join_info = null;
                lock (waitings_) {
                    if (!waitings_.TryGetValue (key, out join_info)) {
                        errMsg = "ignore";
                        goto OnError;
                    }
                    waitings_.Remove (key);
                }

                join_info.CandidatePeer = wi;
                info.Info = join_info;
                info.State = CandidateState.IceProcess;

                dynamic msg2 = new DynamicJson ();
                msg2.r = "ok";
                msg2.s = msg.s;
                join_info.RequestedPeer.Send (msg2.ToString (), JSONEncoding);
                Console.WriteLine ("[CandidateHandler] Relay SDP to join requested peer");

                lock(join_info.IceQueue) {
                    foreach(string ice_cand in join_info.IceQueue) {
                        msg2 = new DynamicJson();
                        msg2.ice = ice_cand;
                        Console.WriteLine("[CandidateHandler] Relay Queued Ice Candidates");
                        info.Info.RequestedPeer.Send(msg2.ToString(), JSONEncoding);
                    }
                }

                return;
            }
            if (info.State == CandidateState.IceProcess) {
                dynamic msg2 = new DynamicJson();
                msg2.ice = msg.ice;
                Console.WriteLine("[CandidateHandler] Relay Ice Candidates");
                info.Info.RequestedPeer.Send(msg2.ToString(), JSONEncoding);
                return;
            }

        OnError:
            Console.WriteLine("[CandidateHandler] ERROR: {0}", errMsg);
            dynamic retMsg = new DynamicJson ();
            retMsg.r = errMsg;
            wi.Send (retMsg.ToString (), JSONEncoding);
            wi.Close ();
        }

        object ProcessStaticFile (IHttpServer server, IHttpRequest req, HttpResponseHeader res)
        {
            string path = Path.Combine (StaticFileDirectory, req.Url.AbsolutePath.Substring (1));
            if (!File.Exists (path))
                throw new HttpException (HttpStatusCode.NotFound);

            res["Content-Type"] = MIMEDatabase.GetMIMEType (Path.GetExtension (path));
            return new FileStream (path, FileMode.Open, FileAccess.Read, FileShare.Read);
        }

        public string StaticFileDirectory { get; set; }

        class ALMInfo
        {
            public ALMInfo ()
            {
                GroupID = null;
                State = ALMGroupState.Initialized;
            }

            public string GroupID { get; set; }
            public string GroupName { get; set; }
            public string GroupDescription { get; set; }

            public ALMGroupState State { get; set; }

            public WebSocketInfo Info { get; set; }
        }
        enum ALMGroupState
        {
            Initialized,
            Created,
            Error
        }

        class JoinInfo
        {
            public JoinInfo () {
                State = JoinState.Initialized;
                IceQueue = new List<string>();
            }

            public string GroupID { get; set; }
            public JoinState State { get; set; }
            public WebSocketInfo RequestedPeer { get; set; }
            public WebSocketInfo CandidatePeer { get; set; }

            public List<string> IceQueue { get; private set; }
        }
        enum JoinState
        {
            Initialized,
            SDPWaiting,
            IceProcess
        }

        class CandidateInfo
        {
            public CandidateInfo() {
                State = CandidateState.Initialized;
            }
            public JoinInfo Info { get; set; }
            public CandidateState State { get; set; }
        }
        enum CandidateState
        {
            Initialized,
            IceProcess
        }
    }
}

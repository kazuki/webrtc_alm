using System;
using Kazuki.Net.HttpServer;

namespace BootstrappingServer
{
    class MainClass
    {
        public static void Main (string[] args)
        {
            WebRTCALMTestApp mainApp = new WebRTCALMTestApp ();
            using (IHttpServer server = HttpServer.CreateEmbedHttpServer (mainApp, null, true, true, true, 8000, 128)) {
                Console.WriteLine ("Press entry key to exit");
                Console.ReadLine ();
            }
        }
    }
}

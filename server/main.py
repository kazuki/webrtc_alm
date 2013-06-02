import alm
import tornado.httpserver
import tornado.ioloop
import tornado.web

application = tornado.web.Application([
    (r"/ws", alm.SimpleALMWebSocket),
    (r"/api/([a-z]+)", alm.SimpleALMAPI),
    (r"/(.*)", tornado.web.StaticFileHandler, {"path": "static"}),
])

def main():
    http_server = tornado.httpserver.HTTPServer(application)
    http_server.listen(8888)
    tornado.ioloop.IOLoop.instance().start()

if __name__ == "__main__":
    main()

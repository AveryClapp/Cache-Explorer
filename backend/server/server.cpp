#include <boost/asio.hpp>
#include <boost/beast.hpp>
#include <iostream>
#include <thread>

namespace beast = boost::beast;
namespace http = beast::http;
namespace websocket = beast::websocket;
using tcp = boost::asio::ip::tcp;

void handle_http(tcp::socket socket) {
  beast::flat_buffer buffer;
  http::request<http::string_body> req;
  http::read(socket, buffer, req);

  http::response<http::string_body> res{http::status::ok, req.version()};
  res.body() = R"({"session_id": "test123"})";
  res.prepare_payload();
  http::write(socket, res);
}

void handle_websocket(websocket::stream<tcp::socket> socket) {
  websocket::stream<tcp::socket> ws{std::move(socket)};
  ws.accept();

  while (true) {
    // Emit cache events from the algorithm
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
  }
}

int main() {
  try {
    boost::asio::io_context ioc;
    tcp::acceptor acceptor{ioc, tcp::endpoint{tcp::v4(), 8080}};

    std::cout << "Server running on port 8080\n";

    while (true) {
      tcp::socket socket{ioc};
      acceptor.accept(socket);

      beast::flat_buffer buffer;
      http::request<http::string_body> req;
      http::read(socket, buffer, req);

      if (websocket::is_upgrade(req)) {
        websocket::stream<tcp::socket> ws{std::move(socket)};
        ws.accept(req);
        handle_websocket(std::move(ws));
      } else {
        handle_http(std::move(socket));
      }
    }
  } catch (std::exception &e) {
    std::cerr << "Error: " << e.what() << "\n";
  }
}

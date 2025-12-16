#pragma once

#include <string>
#include <memory>

namespace CacheExplorer {

/**
 * REST API Server for Cache Explorer
 * Handles HTTP requests for code analysis
 */
class Server {
public:
    explicit Server(int port);
    ~Server();

    // Start the server (blocks until shutdown)
    void run();

    // Stop the server
    void stop();

private:
    class Impl;
    std::unique_ptr<Impl> impl_;
};

} // namespace CacheExplorer

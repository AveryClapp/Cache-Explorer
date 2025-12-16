#include "server.h"
#include <iostream>

int main(int argc, char* argv[]) {
    try {
        // Default port
        int port = 8080;

        if (argc > 1) {
            port = std::stoi(argv[1]);
        }

        std::cout << "Cache Explorer Backend starting on port " << port << "...\n";

        CacheExplorer::Server server(port);
        server.run();

    } catch (const std::exception& e) {
        std::cerr << "Fatal error: " << e.what() << "\n";
        return 1;
    }

    return 0;
}

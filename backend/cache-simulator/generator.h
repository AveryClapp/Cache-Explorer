#pragma once

#include <string>
#include <string_view>

class Generator {
private:
public:
  Generator();

  bool compileToIR(std::string_view inputFile = "code.cpp",
                   std::string_view optimizationLevel = "0");
};

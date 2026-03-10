add_executable(test_matrix test_matrix.c)
target_link_libraries(test_matrix PRIVATE matrix m)

add_test(NAME MatrixCorrectness COMMAND test_matrix)

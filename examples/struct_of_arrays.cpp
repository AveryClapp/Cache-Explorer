// Struct of Arrays (SoA) vs Array of Structs (AoS) - C++ version
// Expected: SoA has better cache behavior for field-specific operations
// Demonstrates: Data-oriented design, cache-friendly layouts

#include <iostream>
#include <vector>

constexpr size_t N = 10000;

// Array of Structs (AoS) - common OOP pattern
// When accessing only one field, we load unnecessary data
struct Particle {
  float x, y, z;       // position
  float vx, vy, vz;    // velocity
  float mass;
  int id;
  // 32 bytes per particle - accessing x loads y, z, vx, vy, vz, mass, id too
};

// Struct of Arrays (SoA) - data-oriented design
// Fields are contiguous in memory
struct ParticleSystem {
  std::vector<float> x, y, z;
  std::vector<float> vx, vy, vz;
  std::vector<float> mass;
  std::vector<int> id;

  explicit ParticleSystem(size_t n)
      : x(n), y(n), z(n)
      , vx(n), vy(n), vz(n)
      , mass(n), id(n) {}
};

// Update positions - AoS version
// Loads entire 32-byte struct to access 6 floats
void update_positions_aos(std::vector<Particle>& particles, float dt) {
  for (auto& p : particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
  }
}

// Update positions - SoA version
// Sequential access to each field array
void update_positions_soa(ParticleSystem& ps, float dt) {
  const size_t n = ps.x.size();
  for (size_t i = 0; i < n; ++i) {
    ps.x[i] += ps.vx[i] * dt;
  }
  for (size_t i = 0; i < n; ++i) {
    ps.y[i] += ps.vy[i] * dt;
  }
  for (size_t i = 0; i < n; ++i) {
    ps.z[i] += ps.vz[i] * dt;
  }
}

// Calculate total kinetic energy - AoS
// Only needs vx, vy, vz, mass but loads all fields
float kinetic_energy_aos(const std::vector<Particle>& particles) {
  float total = 0.0f;
  for (const auto& p : particles) {
    float v2 = p.vx * p.vx + p.vy * p.vy + p.vz * p.vz;
    total += 0.5f * p.mass * v2;
  }
  return total;
}

// Calculate total kinetic energy - SoA
// Only accesses needed arrays
float kinetic_energy_soa(const ParticleSystem& ps) {
  float total = 0.0f;
  const size_t n = ps.vx.size();
  for (size_t i = 0; i < n; ++i) {
    float v2 = ps.vx[i] * ps.vx[i] + ps.vy[i] * ps.vy[i] + ps.vz[i] * ps.vz[i];
    total += 0.5f * ps.mass[i] * v2;
  }
  return total;
}

int main() {
  // Initialize AoS
  std::vector<Particle> aos_particles(N);
  for (size_t i = 0; i < N; ++i) {
    aos_particles[i] = {
      static_cast<float>(i), 0.0f, 0.0f,
      1.0f, 0.5f, 0.25f,
      1.0f,
      static_cast<int>(i)
    };
  }

  // Initialize SoA
  ParticleSystem soa_particles(N);
  for (size_t i = 0; i < N; ++i) {
    soa_particles.x[i] = static_cast<float>(i);
    soa_particles.y[i] = 0.0f;
    soa_particles.z[i] = 0.0f;
    soa_particles.vx[i] = 1.0f;
    soa_particles.vy[i] = 0.5f;
    soa_particles.vz[i] = 0.25f;
    soa_particles.mass[i] = 1.0f;
    soa_particles.id[i] = static_cast<int>(i);
  }

  constexpr float dt = 0.016f;

  // Run updates
  update_positions_aos(aos_particles, dt);
  update_positions_soa(soa_particles, dt);

  // Calculate energy
  float ke_aos = kinetic_energy_aos(aos_particles);
  float ke_soa = kinetic_energy_soa(soa_particles);

  std::cout << "Kinetic energy (AoS): " << ke_aos << '\n';
  std::cout << "Kinetic energy (SoA): " << ke_soa << '\n';

  return 0;
}

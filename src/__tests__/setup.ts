import '@testing-library/jest-dom';
import { vi, beforeEach } from 'vitest';

// Reset signals between tests
beforeEach(() => {
  // Reset authInitDone to false before each test
  vi.resetModules();
});

declare global {
  interface Window {
    __toast?: (message: string) => void;
  }
}

export {};

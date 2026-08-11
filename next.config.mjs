/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [],
  },
  typedRoutes: false,
  // Bundle the coach voice/tone rulebook into serverless traces so
  // prompts.ts can read it at runtime on Vercel.
  outputFileTracingIncludes: {
    "/itc/**": ["./docs/coach-voice-and-tone.md"],
  },
};

export default nextConfig;

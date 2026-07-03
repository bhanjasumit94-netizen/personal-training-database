// Small demo page that showcases the ScrollTiltedGrid component with the
// default Unsplash portrait set. Intended as a reference for how to use
// the component inside the app.
import { ScrollTiltedGrid } from "./scroll-tilted-grid";

export default function ScrollTiltedGridDemo() {
  return (
    <main className="relative min-h-screen overflow-x-hidden bg-zinc-950 text-white">
      <section className="relative flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <h1 className="text-3xl font-medium tracking-tight md:text-5xl">
          A field of stills
        </h1>
        <p className="mt-4 max-w-md text-sm opacity-60">
          Pictures rise from below, settle into focus, then tilt away as the page advances.
        </p>
        <p className="mt-2 max-w-md text-xs opacity-40">
          (Keep scrolling ↓)
        </p>
      </section>

      <ScrollTiltedGrid loop />
    </main>
  );
}

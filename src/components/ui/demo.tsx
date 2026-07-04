// Small demo page that showcases the Liquid Glass Button, Metal Button,
// and the shadcn-style Button variants. Mounted as a separate route
// so the rest of the app is unaffected.
import { LiquidButton, Button, MetalButton } from "./liquid-glass-button";

export default function DemoOne() {
  return (
    <div className="min-h-screen w-full bg-zinc-950 p-8 text-white">
      <h1 className="mb-2 text-2xl font-bold">Liquid Glass Button</h1>
      <p className="mb-8 text-sm text-zinc-400">
        SVG-displaced glass effect with a CSS Grid & inline-shadow border.
      </p>

      <div className="relative h-[200px] w-full max-w-[800px]">
        <LiquidButton className="absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
          Liquid Glass
        </LiquidButton>
      </div>

      <h2 className="mb-4 mt-12 text-xl font-bold">shadcn-style Button</h2>
      <div className="flex flex-wrap gap-3">
        <Button>Default</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="link">Link</Button>
        <Button variant="cool">Cool</Button>
      </div>

      <h2 className="mb-4 mt-12 text-xl font-bold">Metal Button</h2>
      <div className="flex flex-wrap gap-4">
        <MetalButton>Default</MetalButton>
        <MetalButton variant="primary">Primary</MetalButton>
        <MetalButton variant="success">Success</MetalButton>
        <MetalButton variant="error">Error</MetalButton>
        <MetalButton variant="gold">Gold</MetalButton>
        <MetalButton variant="bronze">Bronze</MetalButton>
      </div>
    </div>
  );
}

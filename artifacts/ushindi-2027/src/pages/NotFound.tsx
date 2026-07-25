export default function NotFound() {
  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background px-4">
      <div className="text-center max-w-md">
        <h1 className="text-9xl font-black text-primary font-mono tracking-tighter">404</h1>
        <h2 className="mt-4 text-2xl font-bold text-foreground">Sector Not Found</h2>
        <p className="mt-4 text-muted-foreground mb-8">
          The requested coordinate is outside the operational grid. Return to the command centre.
        </p>
        <a 
          href="/" 
          className="inline-flex items-center justify-center rounded-sm text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-6 py-2"
        >
          Return to Dashboard
        </a>
      </div>
    </div>
  );
}

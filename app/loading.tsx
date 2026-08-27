export default function Loading() {
  return (
    <div className="min-h-screen bg-navy-950 flex items-center justify-center" role="status" aria-label="Loading">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-accent-500" />
    </div>
  );
}

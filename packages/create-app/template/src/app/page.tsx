export default function Home() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {/* Example cards */}
        <div className="rounded-lg border bg-card p-6 text-card-foreground shadow">
          <h3 className="text-lg font-semibold">Card Title</h3>
          <p className="text-sm text-muted-foreground">Add your content here</p>
        </div>

        <div className="rounded-lg border bg-card p-6 text-card-foreground shadow">
          <h3 className="text-lg font-semibold">Card Title</h3>
          <p className="text-sm text-muted-foreground">Add your content here</p>
        </div>

        <div className="rounded-lg border bg-card p-6 text-card-foreground shadow">
          <h3 className="text-lg font-semibold">Card Title</h3>
          <p className="text-sm text-muted-foreground">Add your content here</p>
        </div>
      </div>
    </div>
  )
} 
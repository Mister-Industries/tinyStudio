import { ThemeToggle } from './components/ui/ThemeToggle'

function App(): React.JSX.Element {
  return (
    <>
      <div className="h-fit w-full bg-background flex text-xs justify-between py-1 px-4">
        <div className="flex items-center gap-8">
          <h1 className="flex font-semibold text-lg">
            <p>tiny</p>
            <p className="text-accent">Studio</p>
          </h1>
          <p>by MR.INDUSTRIES</p>
        </div>
        <div className="flex items-center gap-4">
          {/* //TODO: link to documentation */}
          <p>Help</p>
          <ThemeToggle />
          {/* <UserMenu /> */}
        </div>
      </div>
      <div className="h-12 w-full bg-accent">Toolbar</div>
      <div className="size-full bg-background">Content</div>
    </>
  )
}
export default App

import { FolderOpen, BookOpen, GraduationCap, Settings } from 'lucide-react'
import { AvatarFallback, Avatar } from './ui/Avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/DropdownMenu'

export function UserMenu(): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Avatar className="hover:cursor-pointer">
          <AvatarFallback>EE</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem className="group">
          <FolderOpen
            size={14}
            className="mr-2 transition-none text-muted-foreground group-focus:text-accent-foreground transition-colors"
          />
          My Projects
        </DropdownMenuItem>
        <DropdownMenuItem className="group">
          <BookOpen
            size={14}
            className="mr-2 transition-none text-muted-foreground group-focus:text-accent-foreground transition-colors"
          />
          My Tutorials
        </DropdownMenuItem>
        <DropdownMenuItem className="group">
          <GraduationCap
            size={14}
            className="mr-2 transition-none text-muted-foreground group-focus:text-accent-foreground transition-colors"
          />
          My Courses
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="group">
          <Settings
            size={14}
            className="mr-2 transition-none text-muted-foreground group-focus:text-accent-foreground transition-colors"
          />
          Settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

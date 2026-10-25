"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

/** Sidebar button that picks Light, Dark or the device's setting. */
export function ThemeMenu() {
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Theme"
        title="Theme"
        className="rounded-md p-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-white focus-visible:outline-2 focus-visible:outline-sidebar-ring"
      >
        {/* Chosen by CSS, so the icon is right before the theme is known on the client. */}
        <Sun className="size-4 dark:hidden" aria-hidden />
        <Moon className="hidden size-4 dark:block" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-36">
        <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={(v) => setTheme(v as string)}>
          {OPTIONS.map(({ value, label, icon: Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon aria-hidden /> {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

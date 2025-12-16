import { Loader2 } from "lucide-react";

type LoadingScreenProps = {
  message?: string;
};

export function LoadingScreen({ message = "Loading…" }: LoadingScreenProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

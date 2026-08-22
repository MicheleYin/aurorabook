import { Loader2 } from "lucide-react";
import { useTranslation } from "../../lib/i18n";

type LoadingScreenProps = {
  message?: string;
};

export function LoadingScreen({ message }: LoadingScreenProps) {
  const { t } = useTranslation();
  const displayMessage = message ?? t("common.loading");

  return (
    <div className="flex min-h-full items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{displayMessage}</p>
      </div>
    </div>
  );
}

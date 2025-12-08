import { useState, useEffect } from "react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "../ui/select";
import { KOKORO_VOICE_GROUPS } from "../../constants/kokoro";
import type { VoiceId } from "../../types/reader";
import { usePersistentSettings } from "../../hooks/usePersistentSettings";

type ConvertToAudiobookDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (voiceId: VoiceId) => void;
  bookTitle: string;
};

export function ConvertToAudiobookDialog({
  open,
  onOpenChange,
  onConfirm,
  bookTitle,
}: ConvertToAudiobookDialogProps) {
  const { settings } = usePersistentSettings();
  const [selectedVoice, setSelectedVoice] = useState<VoiceId>(settings.ttsVoiceId);

  // Update selected voice when dialog opens or settings change
  useEffect(() => {
    if (open) {
      setSelectedVoice(settings.ttsVoiceId);
    }
  }, [open, settings.ttsVoiceId]);

  const handleConfirm = () => {
    onConfirm(selectedVoice);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Convert to Audiobook?</DialogTitle>
          <DialogDescription>
            This ebook doesn&apos;t have audio tracks. Would you like to convert it to an audiobook using
            text-to-speech? This may take some time depending on the book length.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Book: {bookTitle}</label>
            <div className="space-y-2">
              <label htmlFor="voice-select" className="text-sm font-medium">
                Select Voice:
              </label>
              <Select
                value={selectedVoice}
                onValueChange={(value) => setSelectedVoice(value as VoiceId)}
              >
                <SelectTrigger id="voice-select">
                  <SelectValue placeholder="Select a voice" />
                </SelectTrigger>
                <SelectContent>
                  {KOKORO_VOICE_GROUPS.map((group) => (
                    <SelectGroup key={group.label}>
                      <SelectLabel>{group.label}</SelectLabel>
                      {group.voices.map((voice) => (
                        <SelectItem key={voice.id} value={voice.id}>
                          {voice.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} aria-label="Cancel conversion">
            Cancel
          </Button>
          <Button onClick={handleConfirm} aria-label="Convert to audiobook">Convert to Audiobook</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


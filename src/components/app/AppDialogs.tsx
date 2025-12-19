import { memo } from "react";
import { Button } from "../ui/button";
import { ErrorBoundary } from "../ErrorBoundary";
import { BookDetailDialog } from "../library/BookDetailDialog";
import { ConvertToAudiobookDialog } from "../library/ConvertToAudiobookDialog";
import type { Book } from "../../types/reader";
import type { ConversionProgress } from "../../lib/audiobook-converter";
import type { PendingBookForConversion } from "../../store/slices/conversionSlice";
import { useAppDispatch } from "../../store/hooks";
import { setShowDialog, setPendingBook } from "../../store/slices/conversionSlice";
import { setDetailBookId } from "../../store/slices/readerSlice";

type AppDialogsProps = {
  detailBook?: Book;
  detailBookId: string | null;
  deletingBookId: string | null;
  pendingBookForConversion: PendingBookForConversion | null;
  showConvertDialog: boolean;
  isConverting: boolean;
  isCancelling: boolean;
  cancellingBookId: string | null;
  bookConversionProgress: Record<string, ConversionProgress>;
  conversionStartTimeRef: React.MutableRefObject<number | null>;
  onSelectBook: (bookId: string) => Promise<void>;
  onDeleteBook: (bookId: string) => Promise<void>;
  onConvertBookFromDetail: (book: Book, voiceId: string) => Promise<void>;
  onCancelConversion: (bookId: string) => Promise<void>;
  onConvertToAudiobook: (voiceId: string) => Promise<void>;
};

export const AppDialogs = memo(function AppDialogs({
  detailBook,
  detailBookId,
  deletingBookId,
  pendingBookForConversion,
  showConvertDialog,
  isConverting,
  isCancelling,
  cancellingBookId,
  bookConversionProgress,
  conversionStartTimeRef,
  onSelectBook,
  onDeleteBook,
  onConvertBookFromDetail,
  onCancelConversion,
  onConvertToAudiobook,
}: AppDialogsProps) {
  const dispatch = useAppDispatch();

  const setDetailBookIdHandler = (id: string | null) => {
    dispatch(setDetailBookId(id));
  };

  return (
    <>
      {detailBook ? (
        <ErrorBoundary
          fallback={
            <div className="flex flex-col items-center justify-center p-8 min-h-[200px] bg-card border border-border rounded-lg m-4">
              <h3 className="text-lg font-semibold mb-2">Dialog Error</h3>
              <p className="text-sm text-muted-foreground mb-4 text-center">
                An error occurred while displaying book details.
              </p>
              <Button onClick={() => setDetailBookIdHandler(null)} variant="outline">
                Close
              </Button>
            </div>
          }
        >
          <BookDetailDialog
            book={detailBook}
            open
            onClose={() => setDetailBookIdHandler(null)}
            onOpenBook={() => {
              setDetailBookIdHandler(null);
              onSelectBook(detailBook.id);
            }}
            onDeleteBook={() => onDeleteBook(detailBook.id)}
            isDeleting={Boolean(deletingBookId && deletingBookId === detailBook.id)}
            conversionProgress={bookConversionProgress[detailBook.id]}
            onConvertToAudiobook={onConvertBookFromDetail}
            onCancelConversion={onCancelConversion}
            conversionStartTimeRef={conversionStartTimeRef}
            isCancelling={isCancelling && cancellingBookId === detailBook.id}
          />
        </ErrorBoundary>
      ) : null}
      {pendingBookForConversion ? (
        <ErrorBoundary
          fallback={
            <div className="flex flex-col items-center justify-center p-8 min-h-[200px] bg-card border border-border rounded-lg m-4">
              <h3 className="text-lg font-semibold mb-2">Conversion Dialog Error</h3>
              <p className="text-sm text-muted-foreground mb-4 text-center">
                An error occurred while displaying the conversion dialog.
              </p>
              <Button
                onClick={() => {
                  dispatch(setShowDialog(false));
                  dispatch(setPendingBook(null));
                }}
                variant="outline"
              >
                Close
              </Button>
            </div>
          }
        >
          <ConvertToAudiobookDialog
            open={showConvertDialog && !isConverting && !isCancelling}
            onOpenChange={(open) => {
              if (!isConverting && !isCancelling) {
                dispatch(setShowDialog(open));
                if (!open) {
                  dispatch(setPendingBook(null));
                }
              }
            }}
            onConfirm={onConvertToAudiobook}
            bookTitle={pendingBookForConversion.book.title}
          />
        </ErrorBoundary>
      ) : null}
    </>
  );
});


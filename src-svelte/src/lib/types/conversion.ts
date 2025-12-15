export enum ConversionStep {
	Initializing = 'initializing',
	GeneratingAudio = 'generating-audio',
	ConvertingAudio = 'converting-audio',
	CreatingSmil = 'creating-smil',
	SavingEpub = 'saving-epub',
	Skipping = 'skipping',
	Completed = 'completed',
	Complete = 'complete'
}

export interface ConversionProgress {
	currentChapter: number;
	totalChapters: number;
	wordsProcessed: number;
	totalWords: number;
	wordsInCurrentChapter: number;
	currentStep: ConversionStep;
	message: string;
}

export interface ConversionProgressPayload {
	currentChapter?: number;
	totalChapters?: number;
	wordsProcessed?: number;
	totalWords?: number;
	wordsInCurrentChapter?: number;
	currentStep?: string;
	message?: string;
	sourcePath?: string;
	bookId?: string;
}


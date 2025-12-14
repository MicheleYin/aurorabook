use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LibraryFilterOption {
    All,
    New,
    Resume,
    Finished,
    Recent,
    Author,
}

impl LibraryFilterOption {
    pub const ALL: &'static [LibraryFilterOption] = &[
        LibraryFilterOption::All,
        LibraryFilterOption::New,
        LibraryFilterOption::Resume,
        LibraryFilterOption::Finished,
        LibraryFilterOption::Recent,
        LibraryFilterOption::Author,
    ];

    pub fn label(&self) -> &'static str {
        match self {
            LibraryFilterOption::All => "All books",
            LibraryFilterOption::New => "New",
            LibraryFilterOption::Resume => "Resume reading",
            LibraryFilterOption::Finished => "Finished",
            LibraryFilterOption::Recent => "Recently added",
            LibraryFilterOption::Author => "By author",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LibraryViewMode {
    Grid,
    List,
}

impl LibraryViewMode {
    pub const ALL: &'static [LibraryViewMode] = &[
        LibraryViewMode::Grid,
        LibraryViewMode::List,
    ];
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LibraryBookStatus {
    New,
    Resume,
    Finished,
}

impl LibraryBookStatus {
    pub fn label(&self) -> &'static str {
        match self {
            LibraryBookStatus::New => "New",
            LibraryBookStatus::Resume => "Resume",
            LibraryBookStatus::Finished => "Finished",
        }
    }
}

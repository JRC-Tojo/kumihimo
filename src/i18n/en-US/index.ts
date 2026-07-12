// English localization
export default {
  // Page titles
  title: {
    app: 'Relational Documents',
    documents: 'Documents',
    viewer: 'Document Viewer',
    settings: 'Settings',
  },

  // Common buttons
  button: {
    add: 'Add',
    save: 'Save',
    delete: 'Delete',
    cancel: 'Cancel',
    edit: 'Edit',
    close: 'Close',
    upload: 'Upload',
    refresh: 'Refresh',
    back: 'Back',
    next: 'Next',
    previous: 'Previous',
  },

  // Document related
  document: {
    title: 'Document',
    name: 'Document Name',
    uploadedAt: 'Uploaded At',
    updatedAt: 'Last Updated',
    pages: 'Pages',
    fileSize: 'File Size',
    genre: 'Genre',
    description: 'Description',
    tags: 'Tags',
    noDocuments: 'No documents available',
    createNew: 'Create New Document',
    deleteConfirm: 'Are you sure you want to delete this document?',
  },

  // View modes
  viewMode: {
    rich: 'Rich View',
    list1: 'List View (Wide)',
    list2: 'List View (Compact)',
  },

  // Sort
  sort: {
    byName: 'Sort by Name',
    byUpdatedAt: 'Sort by Last Updated',
    byGenre: 'Sort by Genre',
  },

  // Messages
  message: {
    success: 'Success',
    error: 'An error occurred',
    loading: 'Loading...',
    saving: 'Saving...',
    creatingDocument: 'Creating document...',
    deletingDocument: 'Deleting document...',
    updatingDocument: 'Updating document...',
  },

  // PDF Viewer
  pdf: {
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    pageNumber: 'Page',
    of: '/',
    fitPage: 'Fit Page',
    fitWidth: 'Fit Width',
    singlePage: 'Single Page',
    twoPage: 'Two Pages',
  },

  // Search
  search: {
    placeholder: 'Search...',
    noResults: 'No results found',
  },

  // Settings
  settings: {
    title: 'Settings',
    searchPlaceholder: 'Search settings',
    noResults: 'No settings found',
    darkMode: 'Dark Mode',
    darkModeDesc: 'Switch the whole app color scheme to dark mode.',
    viewMode: 'View Mode',
    viewModeDesc: 'Switch how the container list is displayed.',
    sortBy: 'Sort By',
    sortByDesc: 'Choose the sort order for the container list.',
    language: 'Language',
    languageDesc: 'Switch the display language of the app.',
    save: 'Save Settings',
    sections: {
      general: 'General',
      display: 'Display',
      data: 'Data',
    },
    relationalVerification: {
      title: 'Relational Verification Style',
      ok: 'OK (Verified)',
      okDesc: 'The stroke/fill style applied to an annotation when its relational check succeeds.',
      ng: 'NG (Failed)',
      ngDesc: 'The stroke/fill style applied to an annotation when its relational check fails.',
      strokeColor: 'Stroke Color',
      fillColor: 'Fill Color',
      strokeWidth: 'Stroke Width',
      fillOpacity: 'Fill Opacity',
    },
    sampleData: {
      title: 'Sample Data',
      create: 'Create Sample Documents',
      createDesc: 'Create a batch of sample documents for testing.',
      clear: 'Clear All Data',
      clearDesc: 'Delete all stored data (cannot be undone).',
    },
  },

  // Error messages
  error: {
    documentNotFound: 'Document not found',
    failedToLoadDocument: 'Failed to load document',
    failedToCreateDocument: 'Failed to create document',
    failedToDeleteDocument: 'Failed to delete document',
    failedToUpdateDocument: 'Failed to update document',
  },

  // PDF Editor related
  pdfEditor: {
    tools: {
      line: 'Line',
      box: 'Box',
      circle: 'Circle',
      relationalToggle: 'Relational Annotations',
      annotationToggle: 'Show / Hide Annotations',
      handMode: 'Hand Mode',
      selectMode: 'Select Mode',
      save: {
        title: 'Save',
        overwrite: 'Save Changes',
        saveAs: 'Save As',
        auto: 'Auto Save',
      },
      print: 'Print',
      download: 'Download',
      viewStyle: {
        title: 'Grid View Styles',
        noGrid: 'Single View',
        split: 'Split View',
        grid: 'Grid View',
      },
      relational: {
        equal: 'Equal',
        link: 'Linked',
        off: 'Off',
        cancel: 'Cancel',
        waitingMessage:
          'Waiting for the paired annotation ({mode} mode). Draw or select it to link them.',
        registerSuccess: 'Relationship registered.',
        registerFailed: 'Failed to register the relationship.',
      },
    },
    document: {
      noDocumentSelected: 'No document selected',
      loading: 'Loading...',
    },
    peek: {
      title: 'Relational Peek',
      linkedAnnotations: 'Linked Annotations',
      previewUnavailable: 'Preview unavailable',
      openDocument: 'Open Document',
      rowHint: 'Click to preview, double-click to open in a new tab',
    },
    leftDrawer: {
      title: 'Thumbnails / Bookmarks',
      thumbnail: {
        title: 'Page Thumbnails',
      },
      bookmark: {
        title: 'Bookmarks',
        noBookmarks: 'No Bookmarks',
        page: 'Page',
      },
    },
    rightDrawer: {
      title: 'Annotation Properties',
      annotation: {
        title: 'Annotation Properties',
        type: 'Annotation Type',
        color: 'Drawing Color',
        stroke: 'Stroke Width',
        opacity: 'Fill Opacity',
        relations: 'Registered Relations',
        addRelation: 'Add Relation',
        noRelations: 'No relations',
        selfValue: 'Own value',
        otherValue: 'Other value',
        verifying: 'Verifying...',
        emptyValue: '(empty)',
        delete: 'Delete',
        notSelected: 'Select any annotations',
      },
    },
    footer: {
      viewMode: {
        title: 'View Mode',
        single: 'Single Page',
        c_single: 'Continuous Pages',
        spread: 'Spread Pages',
        c_spread: 'Continuous Spread',
      },
    },
  },

  explorer: {
    demo: 'Create Demo Data',
  },
};

// Sharing one file on its own (/f/<token>). The limits below are enforced by
// supabase/migrations/0421_file_shares.sql; fileShareMigration.test.mjs fails
// the build when the SQL and these numbers disagree.
export const FILE_COMMENT_MAX_CHARS = 2000;
export const FILE_COMMENT_BURST = 20;          // per author …
export const FILE_COMMENT_BURST_MINUTES = 10;  // … in this many minutes
export const FILE_COMMENT_DAILY = 300;         // per author per day
export const FILE_SHARE_PEOPLE_PER_CALL = 20;
export const SHAREABLE_KINDS = Object.freeze(['image', 'video', 'audio', 'pdf', 'file']);
export const RISKY_EXTENSIONS = Object.freeze(['exe','msi','msp','mst','com','scr','pif','cpl','bat','cmd','ps1','psm1','vbs','vbe','js','jse','wsf','wsh','hta','jar','app','dmg','pkg','command','sh','apk','ipa','appx','msix','dll','lnk','reg','iso','html','htm','xhtml','shtml','svg','xml','docm','xlsm','pptm','xll']);
export const RISKY_MIMES = Object.freeze(['text/html','application/xhtml+xml','image/svg+xml','application/x-msdownload','application/x-msdos-program','application/java-archive','application/vnd.android.package-archive','application/x-sh','application/javascript','text/javascript']);

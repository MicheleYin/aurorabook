#[cfg(test)]
mod tests {
    use sqlx::sqlite::{SqlitePool, SqliteConnectOptions};
    use std::str::FromStr;
    use tempfile::TempDir;

    /// Test database connection with different path formats
    #[tokio::test]
    async fn test_sqlite_connection_formats() {
        // Create a temporary directory for testing
        let temp_dir = TempDir::new().expect("Failed to create temp directory");
        let db_path = temp_dir.path().join("test.db");
        let db_path_str = db_path.to_str().unwrap();
        
        println!("Testing database path: {}", db_path_str);
        println!("Path exists: {}", db_path.parent().unwrap().exists());
        println!("Path is absolute: {}", db_path.is_absolute());
        
        // Test using SqliteConnectOptions (recommended approach)
        println!("\n--- Testing SqliteConnectOptions ---");
        match SqliteConnectOptions::from_str(db_path_str)
            .map(|opts| opts.create_if_missing(true))
        {
            Ok(opts) => {
                match SqlitePool::connect_with(opts).await {
                    Ok(pool) => {
                        println!("✓ SUCCESS with SqliteConnectOptions");
                        
                        // Try to create a table
                        match sqlx::query("CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY, name TEXT)")
                            .execute(&pool)
                            .await
                        {
                            Ok(_) => {
                                println!("✓ Table creation successful");
                                
                                // Try to insert data
                                match sqlx::query("INSERT INTO test (name) VALUES (?1)")
                                    .bind("test_value")
                                    .execute(&pool)
                                    .await
                                {
                                    Ok(_) => println!("✓ Insert successful"),
                                    Err(e) => println!("✗ Insert failed: {}", e),
                                }
                            }
                            Err(e) => println!("✗ Table creation failed: {}", e),
                        }
                    }
                    Err(e) => {
                        println!("✗ FAILED to connect with SqliteConnectOptions: {}", e);
                    }
                }
            }
            Err(e) => {
                println!("✗ FAILED to create SqliteConnectOptions: {}", e);
            }
        }
        
        // Test different connection string formats
        let formats = vec![
            format!("sqlite:{}", db_path_str),
            format!("sqlite:///{}", db_path_str),
            format!("sqlite://{}", db_path_str),
        ];
        
        for (i, db_url) in formats.iter().enumerate() {
            println!("\n--- Testing format {}: {} ---", i + 1, db_url);
            
            match SqlitePool::connect(db_url).await {
                Ok(pool) => {
                    println!("✓ SUCCESS with format: {}", db_url);
                    
                    // Try to create a table
                    match sqlx::query("CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY, name TEXT)")
                        .execute(&pool)
                        .await
                    {
                        Ok(_) => {
                            println!("✓ Table creation successful");
                            
                            // Try to insert data
                            match sqlx::query("INSERT INTO test (name) VALUES (?1)")
                                .bind("test_value")
                                .execute(&pool)
                                .await
                            {
                                Ok(_) => println!("✓ Insert successful"),
                                Err(e) => println!("✗ Insert failed: {}", e),
                            }
                        }
                        Err(e) => println!("✗ Table creation failed: {}", e),
                    }
                    
                    break; // Found working format
                }
                Err(e) => {
                    println!("✗ FAILED with format {}: {}", db_url, e);
                }
            }
        }
    }
    
    /// Test database connection with path containing spaces (like "Application Support")
    #[tokio::test]
    async fn test_sqlite_connection_with_spaces() {
        // Create a temporary directory with spaces in the name
        let temp_dir = TempDir::new().expect("Failed to create temp directory");
        let dir_with_spaces = temp_dir.path().join("Application Support");
        std::fs::create_dir_all(&dir_with_spaces).expect("Failed to create dir with spaces");
        
        let db_path = dir_with_spaces.join("test.db");
        let db_path_str = db_path.to_str().unwrap();
        
        println!("\n=== Testing path with spaces ===");
        println!("Database path: {}", db_path_str);
        println!("Path contains spaces: {}", db_path_str.contains(' '));
        
        // Test using SqliteConnectOptions (recommended approach)
        println!("\n--- Testing SqliteConnectOptions with spaces ---");
        match SqliteConnectOptions::from_str(db_path_str)
            .map(|opts| opts.create_if_missing(true))
        {
            Ok(opts) => {
                match SqlitePool::connect_with(opts).await {
                    Ok(pool) => {
                        println!("✓ SUCCESS with SqliteConnectOptions");
                        
                        // Verify it works
                        match sqlx::query("CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY)")
                            .execute(&pool)
                            .await
                        {
                            Ok(_) => println!("✓ Table creation successful"),
                            Err(e) => println!("✗ Table creation failed: {}", e),
                        }
                    }
                    Err(e) => {
                        println!("✗ FAILED to connect with SqliteConnectOptions: {}", e);
                    }
                }
            }
            Err(e) => {
                println!("✗ FAILED to create SqliteConnectOptions: {}", e);
            }
        }
        
        // Test different formats
        let formats = vec![
            format!("sqlite:{}", db_path_str),
            format!("sqlite:///{}", db_path_str),
            // URL encode spaces
            format!("sqlite:///{}", db_path_str.replace(' ', "%20")),
        ];
        
        for (i, db_url) in formats.iter().enumerate() {
            println!("\n--- Testing format {}: {} ---", i + 1, db_url);
            
            match SqlitePool::connect(db_url).await {
                Ok(pool) => {
                    println!("✓ SUCCESS with format: {}", db_url);
                    
                    // Verify it works
                    match sqlx::query("CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY)")
                        .execute(&pool)
                        .await
                    {
                        Ok(_) => println!("✓ Table creation successful"),
                        Err(e) => println!("✗ Table creation failed: {}", e),
                    }
                    
                    break;
                }
                Err(e) => {
                    println!("✗ FAILED: {}", e);
                }
            }
        }
    }
    
    // Note: rusqlite test disabled due to version conflict with sqlx/libsqlite3-sys
    // If needed, this can be re-enabled by using a compatible rusqlite version
    // or by using sqlx for all database operations
    /*
    /// Test using rusqlite directly to compare
    #[test]
    fn test_rusqlite_direct_connection() {
        use rusqlite::Connection;
        
        let temp_dir = TempDir::new().expect("Failed to create temp directory");
        let db_path = temp_dir.path().join("test_rusqlite.db");
        
        println!("\n=== Testing rusqlite direct connection ===");
        println!("Database path: {:?}", db_path);
        
        match Connection::open(&db_path) {
            Ok(conn) => {
                println!("✓ rusqlite connection successful");
                
                match conn.execute("CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY)", []) {
                    Ok(_) => println!("✓ Table creation successful"),
                    Err(e) => println!("✗ Table creation failed: {}", e),
                }
            }
            Err(e) => {
                println!("✗ rusqlite connection failed: {}", e);
            }
        }
    }
    */
}


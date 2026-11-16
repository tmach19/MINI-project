package vn.chinesestudy.dbmigration;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.ConfigurableApplicationContext;

/**
 * Runner one-shot: Liquibase chạy lúc refresh context, sau đó thoát JVM sạch sẽ.
 */
@SpringBootApplication
public class DbMigrationApplication {

    public static void main(String[] args) {
        ConfigurableApplicationContext ctx =
                SpringApplication.run(DbMigrationApplication.class, args);
        int code = SpringApplication.exit(ctx, () -> 0);
        System.exit(code);
    }
}

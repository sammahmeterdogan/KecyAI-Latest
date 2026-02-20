package com.kecyai;

import com.kecyai.infrastructure.RuntimeProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@SpringBootApplication
@EnableConfigurationProperties(RuntimeProperties.class)
public class KecyBackendApplication {

	public static void main(String[] args) {
		SpringApplication.run(KecyBackendApplication.class, args);
	}

}


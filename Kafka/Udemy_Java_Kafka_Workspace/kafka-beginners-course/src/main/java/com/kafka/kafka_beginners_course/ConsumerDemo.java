package com.kafka.kafka_beginners_course;

import java.time.Duration;
import java.util.Arrays;
import java.util.Properties;

import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.ConsumerRecords;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;


public class ConsumerDemo {
	private static Logger logger = LoggerFactory.getLogger(ConsumerDemo.class);

	public static void main(String[] args) {
		
		// consumer properties
		Properties properties = new Properties();
		properties.setProperty(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, "127.0.0.1:9092");
		properties.setProperty(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
		properties.setProperty(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
		properties.setProperty(ConsumerConfig.GROUP_ID_CONFIG, "TariniFirstGroup");
		properties.setProperty(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");
		
		// create consumer
		KafkaConsumer<String, String> kafkaConsumer = new KafkaConsumer<String, String>(properties);
		
		//consumer subscription
		kafkaConsumer.subscribe(Arrays.asList("TariniFirstTopic"));
		
		//poll
		while(true) {
			ConsumerRecords<String, String> records = kafkaConsumer.poll(Duration.ofMillis(100));
			for(ConsumerRecord<String, String> record : records) {
				logger.info("*** Key : {}", record.key());
				logger.info("*** value : {}", record.value());
				logger.info("*** partition : {}", record.partition());
				logger.info("*** offset : {}", record.offset());
				logger.info("--------------------------------");
				
			}
		}
	}
}

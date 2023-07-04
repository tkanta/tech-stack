package com.kafka.kafka_beginners_course;

import java.util.Properties;

import org.apache.kafka.clients.producer.Callback;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.clients.producer.RecordMetadata;
import org.apache.kafka.common.serialization.StringSerializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class ProducerDemoWithKeys {
	
	private static Logger log = LoggerFactory.getLogger(ProducerDemoWithKeys.class);
	
	public static void main(String[] args) {
		
		// producer configuration
		Properties props = new Properties();
		props.setProperty(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "127.0.0.1:9092");
		props.setProperty(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
		props.setProperty(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
		
		// Create producer
		KafkaProducer<String, String> producer = new KafkaProducer<String, String>(props);
		
		
		
		for (int i = 0; i < 10; i++) {
			
			//create producer record
			ProducerRecord<String, String> record = new ProducerRecord<String, String>("TariniFirstTopic", "id:"+1, "Test message : "+i);
			// send 
			producer.send(record, new Callback() {
				public void onCompletion(RecordMetadata meta, Exception ex) {
					if (ex == null) {
						log.info("**** Topic : {}", meta.topic());
						log.info("**** partition : {}", meta.partition());
						log.info("**** offset : {}", meta.offset());
						log.info("**** timestamp : {}", meta.timestamp());
						log.info("------------------------------------");
					} else {

					}
				}
			});
		}
		producer.flush();
		producer.close();
	}
}

package com.kafka.twitter;

import java.util.List;
import java.util.Properties;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import org.apache.kafka.clients.producer.Callback;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.clients.producer.RecordMetadata;
import org.apache.kafka.common.serialization.StringSerializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.google.common.collect.Lists;
import com.twitter.hbc.ClientBuilder;
import com.twitter.hbc.core.Client;
import com.twitter.hbc.core.Constants;
import com.twitter.hbc.core.Hosts;
import com.twitter.hbc.core.HttpHosts;
import com.twitter.hbc.core.endpoint.StatusesFilterEndpoint;
import com.twitter.hbc.core.processor.StringDelimitedProcessor;
import com.twitter.hbc.httpclient.auth.Authentication;
import com.twitter.hbc.httpclient.auth.OAuth1;

public class TwitterProducer {
	
	Logger log = LoggerFactory.getLogger(TwitterProducer.class.getName());
	
	String consumerKey = "BiQD0aZvgQDjICaI4PXJbqwDp";
	String consumerSecret = "Ig1aWEjsMdebjFroFSlOR8l77EIGdKYjKVBj1vgkc55tUb3PW8";
	String accessToken = "1287162253809082368-tLXbv403RmdrzSTj52HyZDRm8dtLve";
	String accessTokenSecret = "6YGUcceEyoC4y35LjbMnaYEEX1QakZzI1cHAZbDRwwdXu";
	
	
	public static void main(String[] args) {
		new TwitterProducer().run();
	}
	
	public void run() {
		BlockingQueue<String> msgQueue = new LinkedBlockingQueue<String>(1000);
		Client client = createTwitterClient(msgQueue);
		client.connect();
		
		KafkaProducer<String, String> kafkaProducer = createKafkaProducer();
		
		
		while (!client.isDone()) {
			String msg = null;
			  try {
				msg = msgQueue.poll(5, TimeUnit.SECONDS);
			} catch (InterruptedException e) {
				// TODO Auto-generated catch block
				e.printStackTrace();
				client.stop();
			}
			
			if(msg != null) {
				//log.info(msg);
				kafkaProducer.send(new ProducerRecord<String,String>("twitter_tweets", null, msg), new Callback() {

					public void onCompletion(RecordMetadata metadata, Exception exception) {
						// TODO Auto-generated method stub
						if(exception != null) {
							log.error("Error : {}", exception.getMessage());
						}
					}
					
				});
			}
			  
			  
		}
	}
	public Client createTwitterClient(BlockingQueue<String> msgQueue) {
		
		/** Declare the host you want to connect to, the endpoint, and authentication (basic auth or oauth) */
		Hosts hosebirdHosts = new HttpHosts(Constants.STREAM_HOST);
		StatusesFilterEndpoint hosebirdEndpoint = new StatusesFilterEndpoint();
		// Optional: set up some followings and track terms
		List<Long> followings = Lists.newArrayList(1234L, 566788L);
		List<String> terms = Lists.newArrayList("bitcoin");
		hosebirdEndpoint.followings(followings);
		hosebirdEndpoint.trackTerms(terms);

		// These secrets should be read from a config file
		Authentication hosebirdAuth = new OAuth1(consumerKey, consumerSecret, accessToken, accessTokenSecret);
		
		ClientBuilder builder = new ClientBuilder()
				  .name("Hosebird-Client-01")                              // optional: mainly for the logs
				  .hosts(hosebirdHosts)
				  .authentication(hosebirdAuth)
				  .endpoint(hosebirdEndpoint)
				  .processor(new StringDelimitedProcessor(msgQueue));
				  //.eventMessageQueue(eventQueue);    // optional: use this if you want to process client events

		Client hosebirdClient = builder.build();
		// Attempts to establish a connection.
		//hosebirdClient.connect();
		return hosebirdClient;
		
	}
	
	
	public KafkaProducer<String, String> createKafkaProducer(){
		
		// producer configuration
		Properties props = new Properties();
		props.setProperty(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "127.0.0.1:9092");
		props.setProperty(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
		props.setProperty(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
		
		// Create producer
		KafkaProducer<String, String> producer = new KafkaProducer<String, String>(props);
		
		return producer;
	}
	
}

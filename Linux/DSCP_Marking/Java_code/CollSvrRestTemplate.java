/*
 * (c) Copyright 2020-2021 TeleCommunication Systems, Inc., a wholly-owned subsidiary
 * of Comtech TeleCommunications Corp. and/or affiliates of TeleCommunication Systems, Inc. 
 * PROPRIETARY/CONFIDENTIAL. Use is subject to license terms.
 * ALL RIGHTS RESERVED
 *
 * The software and information contained herein are proprietary to, and
 * comprise valuable trade secrets of, TeleCommunication Systems, Inc., which
 * intends to preserve as trade secrets such software and information.
 * This software is furnished pursuant to a written license agreement and
 * may be used, copied, transmitted, and stored only in accordance with
 * the terms of such license and with the inclusion of the above copyright
 * notice.  This software and information or any other copies thereof may
 * not be provided or otherwise made available to any other person.
 */

package com.comtechtel.location.positioning.posagent.service.collsvr;

import java.io.File;
import java.io.IOException;
import java.security.KeyManagementException;
import java.security.KeyStoreException;
import java.security.NoSuchAlgorithmException;
import java.security.cert.CertificateException;
import java.util.Collections;
import java.util.Optional;

import javax.annotation.PostConstruct;
import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.SSLContext;

import org.apache.http.client.config.RequestConfig;
import org.apache.http.config.Registry;
import org.apache.http.config.RegistryBuilder;
import org.apache.http.conn.socket.ConnectionSocketFactory;
import org.apache.http.conn.ssl.DefaultHostnameVerifier;
import org.apache.http.conn.ssl.NoopHostnameVerifier;
import org.apache.http.conn.ssl.SSLConnectionSocketFactory;
import org.apache.http.conn.ssl.TrustStrategy;
import org.apache.http.impl.client.HttpClientBuilder;
import org.apache.http.impl.conn.PoolingHttpClientConnectionManager;
import org.apache.http.ssl.SSLContextBuilder;
import org.apache.http.ssl.SSLContexts;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.BufferingClientHttpRequestFactory;
import org.springframework.http.client.ClientHttpRequestFactory;
import org.springframework.http.client.HttpComponentsClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import com.comtechtel.location.positioning.posagent.utils.TrafficClassPlainConnectionSocketFactory;
import com.comtechtel.location.positioning.posagent.utils.TrafficClassSSLConnectionSocketFactory;
import com.xypoint.cfg.XtConfig;
import com.xypoint.cfg.XtConfigRange;

/**
 * Configuration for the {@link RestTemplate} to be used for calls to the Collection Server.
 */
@Component
public class CollSvrRestTemplate
{
    private static final Logger LOGGER = LoggerFactory.getLogger(CollSvrRestTemplate.class);

    @Autowired
    private Environment env;

    @Autowired
    private CollSvrService collSvrService;

    @Autowired
    private RequestConfig collSvrRequestConfig;

    private XtConfig<Boolean> validateServerCertificateConfig;
    private XtConfig<String> trustStorePathConfig;
    private XtConfig<String> trustStoreTypeConfig;
    private XtConfig<Boolean> verifyHostnameConfig;
    private XtConfig<Integer> maxConnectionPoolSize;
    private XtConfigRange<Short> dscpConfig;

    private volatile boolean validateServerCertificate;
    private volatile Optional<String> trustStorePath;
    private volatile String trustStoreType;
    private volatile boolean verifyHostname;
    private short dscp;

    private volatile Optional<RestTemplate> restTemplate;

    @PostConstruct
    @SuppressWarnings("javadoc")
    public void init()
    {
        maxConnectionPoolSize = new XtConfig<Integer>("PosAgent.CollServer.MaxConnectionPoolSize",
                "The maximum number of connections per route maintained in the connection pool", Integer.valueOf(10),
                false);
        initDscp();
        initServerCertificateValidation();
        initTrustStorePath();
        initTrustStoreType();
        initHostnameVerification();
        refresh();
    }

    private void initDscp()
    {
        dscpConfig = new XtConfigRange<Short>("PosAgent.CollServer.Dscp",
                "The Differentiated Services Code Point (DSCP) value to be set in the DS field in IP packet headers",
                true, Short.valueOf((short) -1), Short.valueOf((short) -1), Short.valueOf((short) 63), false);
        dscpConfig.setConfigChangedCallback(() -> {
            short newValue = dscpConfig.getValue().shortValue();
            if (dscp != newValue)
            {
                dscp = newValue;
                updateRestTemplate("Setting DSCP to: " + dscp);
            }
        });
        dscp = dscpConfig.getValue().shortValue();
    }

    private void initServerCertificateValidation()
    {
        validateServerCertificateConfig = new XtConfig<Boolean>("PosAgent.CollServer.TLS.ValidateServerCert",
                "Whether the to check the server certificate for authenticity", Boolean.TRUE);
        validateServerCertificateConfig.setConfigChangedCallback(() -> {
            boolean newValue = validateServerCertificateConfig.getValue().booleanValue();
            if (validateServerCertificate != newValue)
            {
                validateServerCertificate = newValue;
                updateRestTemplate("Setting server certificate validation to: " + validateServerCertificate);
            }
        });
        validateServerCertificate = validateServerCertificateConfig.getValue().booleanValue();
    }

    private void initTrustStorePath()
    {
        trustStorePathConfig = new XtConfig<String>("PosAgent.CollServer.TLS.TrustStore.Path",
                "Path to the store on the local filesystem for trusted certificates", "");
        trustStorePathConfig.setConfigChangedCallback(() -> {
            String newValue = trustStorePathConfig.getValue();
            if (!trustStorePath.equals(Optional.of(newValue)))
            {
                trustStorePath = newValue.equals("") ? Optional.empty() : Optional.of(newValue);
                String successLogMessage = trustStorePath.isPresent()
                        ? "Trust store path updated to: " + trustStorePath.get()
                        : "Trust store path updated to default value";
                updateRestTemplate(successLogMessage);
            }
        });
        trustStorePath = trustStorePathConfig.getValue().equals("") ? Optional.empty()
                : Optional.of(trustStorePathConfig.getValue());
    }

    private void initTrustStoreType()
    {
        trustStoreTypeConfig = new XtConfig<String>("PosAgent.CollServer.TLS.TrustStore.Type",
                "The archive file format for the encrypted trust store", "pkcs12");
        trustStoreTypeConfig.setConfigChangedCallback(() -> {
            String newValue = trustStoreTypeConfig.getValue();
            if (!trustStoreType.equals(newValue))
            {
                trustStoreType = newValue;
                updateRestTemplate("Trust store type updated to: " + trustStoreType);
            }
        });
        trustStoreType = trustStoreTypeConfig.getValue();
    }

    private void initHostnameVerification()
    {
        verifyHostnameConfig = new XtConfig<Boolean>("PosAgent.CollServer.TLS.VerifyHostname",
                "Whether a server identity check should be performed or not", Boolean.TRUE);
        verifyHostnameConfig.setConfigChangedCallback(() -> {
            boolean newValue = verifyHostnameConfig.getValue().booleanValue();
            if (verifyHostname != newValue)
            {
                verifyHostname = verifyHostnameConfig.getValue().booleanValue();
                updateRestTemplate("Setting hostname verification to: " + verifyHostname);
            }
        });
        verifyHostname = verifyHostnameConfig.getValue().booleanValue();
    }

    /**
     * Replaces the existing managed {@link RestTemplate} with a new instance.
     * 
     * @throws CollSvrRestTemplateException
     *             if the attempt to refresh the RestTemplate fails. This can occur when updateable config has be
     *             changed in an invalid way while the application is running.
     */
    public void refresh() throws CollSvrRestTemplateException
    {
        try
        {
            restTemplate = Optional.of(getManagedRestTemplate());
        }
        catch (Exception e)
        {
            throw new CollSvrRestTemplateException(
                    "CollSvrRestTemplate could not be instantiated due to invalid configuration", e);
        }
    }

    private void updateRestTemplate(String successLogMessage)
    {
        try
        {
            restTemplate = Optional.of(getManagedRestTemplate());
            LOGGER.debug(successLogMessage);
        }
        catch (Exception e)
        {
            restTemplate = Optional.empty();
            LOGGER.error("CollSvrRestTemplate could not be instantiated due to invalid configuration: {}", e);
        }
    }

    /**
     * Sets the wrapped rest template. Useful for testing.
     * 
     * @param restTemplate
     *            the rest template to set
     */
    public void setRestTemplate(RestTemplate restTemplate)
    {
        this.restTemplate = Optional.of(restTemplate);
    }

    /**
     * Gets the wrapped rest template. Useful for testing.
     * 
     * @return the wrapped rest template
     */
    public Optional<RestTemplate> getRestTemplate()
    {
        return restTemplate;
    }

    /**
     * Returns true if the wrapped rest template is present. This may be false if updateable config relating to the rest
     * template has be changed in an invalid way while the application is running
     * 
     * @return true if the wrapped rest template is present
     */
    public boolean isRestTemplatePresent()
    {
        return this.restTemplate.isPresent();
    }

    /**
     * Gets the {@link RestTemplate} to be used in calls to the Z-Axis Collection Server This singleton maintains an
     * HTTP connection pool which is configurable via the standard PosAgent configuration mechanism.
     * 
     * @return the {@link RestTemplate} instance
     * @throws Exception
     *             if the rest template could not be instantiated
     */
    private RestTemplate getManagedRestTemplate() throws Exception
    {
        RestTemplate template = new RestTemplate(new BufferingClientHttpRequestFactory(getClientHttpRequestFactory()));
        template.setErrorHandler(new CollSvrRestTemplateErrorHandler());
        template.setInterceptors(Collections.singletonList(new CollSvrRestTemplateInterceptor()));
        return template;
    }

    /**
     * Gets the client HTTP request factory
     * 
     * @return the factory
     * @throws Exception
     *             if the request factory could not be instantiated
     */
    public ClientHttpRequestFactory getClientHttpRequestFactory() throws Exception
    {
        HttpClientBuilder httpClientBuilder = HttpClientBuilder.create();
        Registry<ConnectionSocketFactory> registry = getRegistry(httpClientBuilder);
        httpClientBuilder.setConnectionManager(getConnectionManager(registry));
        httpClientBuilder.setDefaultRequestConfig(collSvrRequestConfig);
        return new HttpComponentsClientHttpRequestFactory(httpClientBuilder.build());
    }

    private Registry<ConnectionSocketFactory> getRegistry(HttpClientBuilder httpClientBuilder)
            throws KeyManagementException, NoSuchAlgorithmException, KeyStoreException, CertificateException,
            IOException
    {
        SSLContext sslContext = getSslContext();
        RegistryBuilder<ConnectionSocketFactory> registryBuilder = RegistryBuilder.create();
        LOGGER.debug("Registering support for HTTP protocol");
        registryBuilder.register("http", new TrafficClassPlainConnectionSocketFactory(getTrafficClass(dscp)));
        if (requireSSLSupport())
        {
            LOGGER.debug("Registering support for HTTPS protocol");
            HostnameVerifier hostnameVerifier = getHostnameVerifier();
            httpClientBuilder.setSSLHostnameVerifier(hostnameVerifier);
            httpClientBuilder.setSSLContext(sslContext);
            SSLConnectionSocketFactory sslConnectionSocketFactory = new TrafficClassSSLConnectionSocketFactory(sslContext,
                    hostnameVerifier, getTrafficClass(dscp));
            httpClientBuilder.setSSLSocketFactory(sslConnectionSocketFactory);
            registryBuilder.register("https", sslConnectionSocketFactory);
        }
        return registryBuilder.build();
    }

    private static int getTrafficClass(short dscpValue)
    {
        if (dscpValue < 0)
        {
            return 0;
        }
        return dscpValue << 2;
    }
    
    private SSLContext getSslContext() throws NoSuchAlgorithmException, KeyStoreException, CertificateException,
            IOException, KeyManagementException
    {
        SSLContextBuilder sslContextBuilder = SSLContexts.custom().setProtocol("TLS");
        if (validateServerCertificate)
        {
            LOGGER.debug("Enabling support for server certificate validation");
            if (trustStorePath.isPresent())
            {
                LOGGER.debug("Using trust store path: {}", trustStorePath.get());
                LOGGER.debug("Using trust store type: {}", trustStoreType);
                String trustStorePassword = env.getProperty("ZAXIS_CLIENT_TLS_TRUSTSTORE_PASSWORD", "superSecret");
                sslContextBuilder.setKeyStoreType(trustStoreType);
                sslContextBuilder.loadTrustMaterial(new File(trustStorePath.get()), trustStorePassword.toCharArray());
                LOGGER.debug("Trust material loaded");
            }
            else
            {
                LOGGER.debug("Using default trust store path and type");
            }
        }
        else
        {
            LOGGER.debug("Support for server certificate validation is not enabled");
            TrustStrategy trustAllStrategy = (cert, authType) -> true;
            sslContextBuilder.loadTrustMaterial(trustAllStrategy);
        }
        return sslContextBuilder.build();
    }

    private boolean requireSSLSupport()
    {
        return collSvrService.getServer1().getServerScheme().equals("https")
                || collSvrService.getServer2().getServerScheme().equals("https");
    }

    private HostnameVerifier getHostnameVerifier()
    {
        HostnameVerifier hostnameVerifier;
        if (verifyHostname)
        {
            LOGGER.debug("Enabling support for hostname verification");
            hostnameVerifier = new DefaultHostnameVerifier();
        }
        else
        {
            LOGGER.debug("Support for hostname verification is not enabled");
            hostnameVerifier = NoopHostnameVerifier.INSTANCE;
        }
        return hostnameVerifier;
    }

    PoolingHttpClientConnectionManager getConnectionManager(Registry<ConnectionSocketFactory> registry)
    {
        PoolingHttpClientConnectionManager connectionManager = new PoolingHttpClientConnectionManager(registry);
        connectionManager.setMaxTotal(maxConnectionPoolSize.getValue().intValue());
        return connectionManager;
    }

    /**
     * @return The request config to use for Z-Axis request attempts.
     */
    @Bean
    public RequestConfig requestConfig()
    {
        int connectTimeout = new XtConfig<Integer>("PosAgent.CollServer.ConnectTimeoutMillis",
                "The maximum interval in milliseconds after which the URL connection's attempt to connect is considered to have failed.",
                Integer.valueOf(3000), false).getValue().intValue();
        int readTimeout = new XtConfig<Integer>("PosAgent.CollServer.ReadTimeoutMillis",
                "The maximum interval in milliseconds of inactivity between consecutive data packets.",
                Integer.valueOf(3000), false).getValue().intValue();
        RequestConfig requestConfig = RequestConfig.custom().setConnectionRequestTimeout(connectTimeout)
                .setConnectTimeout(connectTimeout).setSocketTimeout(readTimeout).build();
        return requestConfig;
    }

    /**
     * Wraps a call to the managed {@link RestTemplate}. If the template is not present (because updateable config has
     * been changed in an invalid way while the application is running, then calling this method will result in an
     * {@link IllegalStateException} being thrown.
     * 
     * @see RestTemplate#exchange(String, HttpMethod, HttpEntity, Class, Object...)
     * @throws CollSvrRestTemplateException
     *             if the wrapped {@link RestTemplate} is not instantiated. This can occur when updateable config has
     *             been changed in an invalid way while the application is running.
     */
    @SuppressWarnings("javadoc")
    public ResponseEntity<String> exchange(String url, HttpMethod get, HttpEntity<?> entity, Class<String> clazz)
            throws IllegalStateException
    {
        return restTemplate
                .orElseThrow(() -> new CollSvrRestTemplateException(
                        "RestTemplate could not be instantiated due to invalid configuration"))
                .exchange(url, get, entity, clazz);
    }
}
